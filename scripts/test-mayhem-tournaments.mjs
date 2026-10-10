// Actual Mayhem persistence/actions, isolated PostgreSQL; no production access.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const db = new PGlite();
let authorized = true;
let member = { discordUserId: '123456789', displayName: 'Member', avatarUrl: null };
let failDelete = false;
const invalidations = [];
const messages = [];
let transactionDepth = 0;
let onDm;
const client = { query: async (text, params) => {
  if (text.trim() === 'BEGIN') transactionDepth++;
  if (text.trim() === 'COMMIT' || text.trim() === 'ROLLBACK') transactionDepth--;
  if (failDelete && text.includes('DELETE FROM mayhem_events')) throw Error('Injected deletion failure');
  return db.query(text, params);
}, release() {} };
const sql = Object.assign((parts, ...params) => client.query(parts.reduce((s,p,i) => s + (i ? `$${i}` : '') + p, ''), params), {query: client.query, connect: async () => client});
const stubs = {
  '@vercel/postgres': {sql},
  'next/cache': {revalidatePath: p => invalidations.push(p)},
  'next/server': {NextResponse:{json:(data,init={})=>({data,status:init.status??200,headers:init.headers})}},
  '@/lib/tools-auth': {isToolsSession: async () => authorized, getCurrentAdmin: async () => authorized ? {discordUserId:'admin',username:'Admin'} : null},
  '@/lib/discord-bot': {fetchGuildMemberById: async id => ({displayName:`Invitee ${id}`,avatarUrl:null,isBot:false}), sendDirectMessage: async (id, content) => { assert.equal(transactionDepth,0,'Discord network delivery must never hold the event lock'); messages.push({id,content}); if (onDm) await onDm(); return {ok:true}; }},
  '@/lib/discord-auth': {getMemberSession: async () => member, trustedOrigin: () => 'https://example.test'},
};
function loader() {
  const cache = new Map();
  function load(name) {
    if (stubs[name]) return stubs[name];
    if (!name.startsWith('@/')) return require(name);
    if (cache.has(name)) return cache.get(name);
    const source = readFileSync(`src/${name.slice(2)}.ts`, 'utf8');
    const exports = {};
    cache.set(name, exports);
    runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,
      {exports,require: dep => load(dep.startsWith('./') ? name.slice(0,name.lastIndexOf('/')+1)+dep.slice(2) : dep),console,process,Buffer,Error,setTimeout,clearTimeout,URL,Date});
    return exports;
  }
  return load;
}
try {
  let load = loader();
  let store = load('@/lib/mayhem-db');
  await store.ensureSchema();
  assert.equal((await db.query('SELECT id FROM mayhem_events')).rows.length, 0, 'Schema setup must not manufacture or resurrect a singleton');
  console.log('PASS: fresh schema has no automatic singleton.');
  const actions = load('@/app/tools/mayhem/actions');
  assert.equal(typeof actions.createMayhemEvent, 'function', 'Must expose explicit named event creation');
  const created = await actions.createMayhemEvent('Independent event');
  assert.equal(created.ok, true);
  const selection = {eventId:created.eventId,generation:0};
  await actions.addPlayer(selection, 'Player A');
  assert.equal((await store.getMayhemFull(created.eventId)).players.length, 1);
  console.log('PASS: explicit creation and selected-event roster mutation.');
  const other = await actions.createMayhemEvent('Other event');
  const otherSelection = {eventId:other.eventId,generation:0};
  await actions.addPlayer(otherSelection, 'Player B');
  assert.equal((await store.getMayhemFull(created.eventId)).players[0].display_name, 'Player A');
  assert.equal((await store.getMayhemFull(other.eventId)).players[0].display_name, 'Player B');
  assert.equal((await store.listMayhemEvents()).length, 2);
  await assert.rejects(store.getMayhemPublic(created.eventId), /not found/);
  assert.equal((await actions.setMayhemPublished(selection, true)).ok, true);
  assert.equal((await store.getMayhemPublic(created.eventId)).id, created.eventId);
  assert.equal((await actions.archiveMayhemEvent(selection)).ok, true);
  await assert.rejects(actions.addPlayer(selection,'Stale'), /archived/);
  assert.equal((await actions.joinMayhemAsMember(selection,0)).ok,false);
  assert.equal((await store.getMayhemFull(created.eventId)).players.length,1);
  assert.ok((await store.listMayhemEvents()).some(e => e.id === created.eventId && e.archived_at));
  await assert.rejects(store.getMayhemPublic(created.eventId), /not found/);
  assert.equal((await actions.deleteMayhemEvent({eventId:created.eventId,generation:1})).ok,true);
  assert.equal((await store.getMayhemFull(other.eventId)).players.length,1);
  const cold = loader()('@/lib/mayhem-db');
  await cold.ensureSchema();
  assert.equal((await db.query("SELECT id FROM mayhem_events WHERE id = 'mayhem-main'")).rows.length,0);
  console.log('PASS: isolation, draft boundary, archive preservation/denial, deletion and cold-start no resurrection.');
  // Reset to the production pre-lifecycle DDL, seed the real legacy row and
  // every child table, then run the actual additive migration cold.
  await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const production = readFileSync('src/lib/mayhem-db.ts','utf8');
  for (const match of production.slice(0,production.indexOf('// Existing mayhem-main')).matchAll(/await schemaSql`([\s\S]*?)`;/g)) await db.exec(match[1]);
  await db.query("INSERT INTO mayhem_events (id,title,stage,format,registration_open) VALUES ('mayhem-main','Existing meetup','completed',$1::jsonb,true)", [JSON.stringify(load('@/types/mayhem').DEFAULT_FORMAT_CONFIG)]);
  await db.exec(`INSERT INTO mayhem_groups (id,event_id,label) VALUES ('legacy-group','mayhem-main','Group A');
    INSERT INTO mayhem_teams (id,event_id,name,reveal_order,group_id,captain_discord_id) VALUES ('legacy-team','mayhem-main','Champions',0,'legacy-group','secret-captain');
    INSERT INTO mayhem_players (id,event_id,display_name,entry_order,team_id,member_discord_id) VALUES ('legacy-player','mayhem-main','Legacy player',0,'legacy-team','secret-member');
    INSERT INTO mayhem_matches (id,event_id,bracket,round_number,match_number,team_a_id,winner_id,status) VALUES ('legacy-match','mayhem-main','upper',1,1,'legacy-team','legacy-team','completed');
    UPDATE mayhem_events SET champion_team_id = 'legacy-team', active_match_id = 'legacy-match' WHERE id = 'mayhem-main';
    INSERT INTO mayhem_team_applications (id,event_id,team_name,captain_discord_id) VALUES ('legacy-app','mayhem-main','Pending','another-captain');
    INSERT INTO mayhem_team_application_slots (id,application_id,member_discord_id,status) VALUES ('legacy-slot','legacy-app','invitee','pending');
    INSERT INTO mayhem_audit_log (id,event_id,action,actor_discord_id,actor_name) VALUES ('legacy-audit','mayhem-main','existing.action','admin','Admin');`);
  const tables = ['mayhem_players','mayhem_teams','mayhem_groups','mayhem_matches','mayhem_team_applications','mayhem_team_application_slots','mayhem_audit_log'];
  async function snapshot() { const result = {}; for (const table of tables) result[table]=(await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows; return result; }
  const legacyChildren = await snapshot();
  load = loader(); store = load('@/lib/mayhem-db');
  const migratedActions = load('@/app/tools/mayhem/actions');
  await store.ensureSchema();
  assert.deepEqual(await snapshot(), legacyChildren);
  const legacy = await store.getMayhemFull('mayhem-main');
  assert.equal(legacy.event.title,'Existing meetup');
  assert.equal(legacy.event.stage,'completed');
  assert.equal(legacy.event.champion_team_id,'legacy-team');
  assert.equal(legacy.event.published,true);
  assert.equal((await store.getMayhemPublic()).id,'mayhem-main');
  console.log('PASS: production DDL migration preserves legacy event, champion and every child record.');

  const pin = {eventId:'mayhem-main',generation:0};
  const safety = await migratedActions.createMayhemEvent('Unrelated safe event');
  const safePin = {eventId:safety.eventId,generation:0};
  await migratedActions.addPlayer(safePin,'Safe player');
  assert.equal((await migratedActions.setMayhemPublished(safePin,true)).ok,true);
  // Reveal/public payloads must not leak any Discord identity or unrevealed draft roster.
  await db.exec("UPDATE mayhem_events SET stage = 'randomized', scene = 'reveal', reveal_index = 0 WHERE id = 'mayhem-main'");
  assert.equal((await store.getMayhemPublic('mayhem-main')).teams.length,0);
  const hiddenVenue = await store.getMayhemVenueState('mayhem-main');
  assert.ok(!JSON.stringify(hiddenVenue).includes('secret-captain'));
  assert.ok(!JSON.stringify(hiddenVenue).includes('secret-member'));
  assert.ok(!JSON.stringify(hiddenVenue).includes('Champions'), 'Venue polling must withhold unrevealed team identities');
  await db.exec("UPDATE mayhem_events SET stage = 'completed', scene = 'champion' WHERE id = 'mayhem-main'");
  console.log('PASS: public and venue projections protect Discord identities and reveal boundary.');

  // A database-side post-delete failure proves cascade rollback, not just a
  // mock rejection before the statement could affect children.
  await db.exec(`CREATE FUNCTION reject_mayhem_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced delete rollback'; END $$;
    CREATE TRIGGER reject_mayhem_delete AFTER DELETE ON mayhem_events FOR EACH ROW EXECUTE FUNCTION reject_mayhem_delete();`);
  const beforeRollback = await snapshot(); invalidations.length=0;
  const failed = await migratedActions.deleteMayhemEvent(pin);
  assert.equal(failed.ok,false); assert.match(failed.reason,/forced delete rollback/);
  assert.deepEqual(await snapshot(),beforeRollback);
  assert.equal((await store.getMayhemFull('mayhem-main')).event.champion_team_id,'legacy-team');
  assert.equal(invalidations.length,0);
  await db.exec('DROP TRIGGER reject_mayhem_delete ON mayhem_events; DROP FUNCTION reject_mayhem_delete();');
  console.log('PASS: real PostgreSQL post-delete failure restores cascades and event state.');

  authorized=false; invalidations.length=0;
  for (const fn of [() => migratedActions.createMayhemEvent('Forbidden'), () => migratedActions.archiveMayhemEvent(pin), () => migratedActions.deleteMayhemEvent(pin), () => migratedActions.setMayhemPublished(pin,false)]) {
    const result=await fn(); assert.equal(result.ok,false); assert.match(result.reason,/Not authorized/);
  }
  await assert.rejects(migratedActions.clearAllPlayers(pin),/Not authorized/);
  assert.deepEqual(await snapshot(),beforeRollback); assert.equal(invalidations.length,0);
  authorized=true;
  for (const selection of [{eventId:'missing',generation:0}, {eventId:'mayhem-main',generation:99}, {eventId:'',generation:0}]) {
    assert.equal((await migratedActions.deleteMayhemEvent(selection)).ok,false);
    assert.equal((await migratedActions.archiveMayhemEvent(selection)).ok,false);
    assert.equal((await migratedActions.joinMayhemAsMember(selection,selection.generation)).ok,false);
  }
  console.log('PASS: missing, invalid, stale-generation and unauthorized lifecycle requests leave data intact.');

  const priorArchive = await snapshot();
  await db.exec(`CREATE FUNCTION reject_mayhem_archive() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.archived_at IS NOT NULL THEN RAISE EXCEPTION 'forced archive rollback'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_mayhem_archive BEFORE UPDATE ON mayhem_events FOR EACH ROW EXECUTE FUNCTION reject_mayhem_archive();`);
  const failedArchive=await migratedActions.archiveMayhemEvent(pin);
  assert.equal(failedArchive.ok,false);assert.match(failedArchive.reason,/forced archive rollback/);
  assert.deepEqual(await snapshot(),priorArchive);
  assert.equal((await store.getMayhemFull('mayhem-main')).event.archived_at,null);
  assert.equal((await store.getMayhemFull('mayhem-main')).event.registration_generation,0);
  await db.exec('DROP TRIGGER reject_mayhem_archive ON mayhem_events; DROP FUNCTION reject_mayhem_archive();');
  console.log('PASS: PostgreSQL archive failure rolls back audit, reveal and registration generation.');
  assert.equal((await migratedActions.archiveMayhemEvent(pin)).ok,true);
  const archived = await store.getMayhemFull('mayhem-main');
  assert.ok(archived.event.archived_at); assert.equal(archived.event.registration_open,false); assert.equal(archived.event.registration_generation,1);
  for (const table of tables.filter(t => t !== 'mayhem_audit_log')) assert.deepEqual((await snapshot())[table],priorArchive[table]);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM mayhem_audit_log WHERE event_id='mayhem-main'")).rows[0].n,2);
  const archivedSnapshot = await snapshot();
  const adminNames=['addPlayer','bulkAddPlayers','removePlayer','renamePlayer','refreshTeamIdentities','clearAllPlayers','setTeamFormat','setRegistrationOpen','randomizeTeams','finalizePremadeTeams','setScene','startCountdown','advanceReveal','startAutoReveal','pauseAutoReveal','hideLastReveal','restartReveal','updateFormat','generateGroups','generateKnockoutFromGroups','generateKnockoutFromAllTeams','setActiveMatch','recordMatchResult','reportBo1Winner','undoMatchResult'];
  for (const name of adminNames) await assert.rejects(migratedActions[name](pin), /archived/, name);
  const publicNames=['joinMayhemAsMember','leaveMayhemAsMember','createPremadeApplication','addDraftMember','sendApplicationInvites','retryInviteDelivery','withdrawApplicationSlot','confirmApplicationSlot','declineApplicationSlot','withdrawApplication','leavePremadeTeam'];
  for (const name of publicNames) { const result=await migratedActions[name](pin); assert.equal(result.ok,false,name); assert.match(result.reason,/archived/,name); }
  assert.equal((await migratedActions.setMayhemPublished(pin,true)).ok,false);
  assert.deepEqual(await snapshot(),archivedSnapshot);
  assert.equal((await store.getMayhemPublic()).id,safety.eventId);
  assert.equal((await store.listMayhemEvents()).length,2);
  console.log(`PASS: archive preserves all child history; ${adminNames.length} admin and ${publicNames.length} public mutation paths reject archived selections.`);
  assert.equal((await migratedActions.deleteMayhemEvent({eventId:'mayhem-main',generation:1})).ok,true);
  for (const table of tables) {
    const query=table === 'mayhem_team_application_slots' ? `SELECT id FROM ${table} WHERE id = 'legacy-slot'` : `SELECT id FROM ${table} WHERE event_id = 'mayhem-main'`;
    assert.equal((await db.query(query)).rows.length,0,table);
  }
  assert.equal((await store.getMayhemFull(safety.eventId)).players[0].display_name,'Safe player');
  await loader()('@/lib/mayhem-db').ensureSchema();
  assert.equal((await db.query("SELECT id FROM mayhem_events WHERE id='mayhem-main'")).rows.length,0);
  const afterDelete=await snapshot();
  await assert.rejects(migratedActions.addPlayer(pin,'Must not fall through'),/not found/);
  assert.equal((await migratedActions.joinMayhemAsMember(pin,0)).ok,false);
  assert.deepEqual(await snapshot(),afterDelete);
  console.log('PASS: hard delete cascades every child including pending slots/audit, preserves other event, and stale requests never fall through.');

  // Reset invalidates both admin and public selections, even though the event
  // id remains unchanged. Explicit new pins work only after refreshing.
  await migratedActions.clearAllPlayers(safePin);
  await assert.rejects(migratedActions.addPlayer(safePin,'Stale'),/changed/);
  assert.equal((await migratedActions.leaveMayhemAsMember(safePin)).ok,false);
  const resetPin={eventId:safety.eventId,generation:1};
  await migratedActions.setRegistrationOpen(resetPin,true);
  assert.equal((await migratedActions.joinMayhemAsMember(resetPin,1)).ok,true);
  assert.equal((await migratedActions.leaveMayhemAsMember(resetPin)).ok,true);
  assert.equal((await store.getMayhemFull(safety.eventId)).players.length,0);
  console.log('PASS: reset generation rejects stale admin/public writes; refreshed verified-member join/leave works.');
  // Failed creation must not leave a half-created saved event.
  await db.exec(`CREATE FUNCTION reject_mayhem_create_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'event.create' THEN RAISE EXCEPTION 'forced create rollback'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_mayhem_create_audit BEFORE INSERT ON mayhem_audit_log FOR EACH ROW EXECUTE FUNCTION reject_mayhem_create_audit();`);
  const countBefore=(await db.query('SELECT count(*)::int AS n FROM mayhem_events')).rows[0].n;
  assert.equal((await migratedActions.createMayhemEvent('Failed create')).ok,false);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM mayhem_events')).rows[0].n,countBefore,'Creation and its audit must be atomic');
  await db.exec('DROP TRIGGER reject_mayhem_create_audit ON mayhem_audit_log; DROP FUNCTION reject_mayhem_create_audit();');
  console.log('PASS: failed creation rolls back the event and its audit.');
  // Premade writes and token recipients are independently pinned to the event.
  await migratedActions.setRegistrationOpen(resetPin,false);
  await migratedActions.setTeamFormat(resetPin,'premade');
  await migratedActions.setRegistrationOpen(resetPin,true);
  const app = await migratedActions.createPremadeApplication(resetPin,'Selected application',1);
  assert.equal(app.ok,true);
  for (const id of ['200001','200002','200003','200004']) assert.equal((await migratedActions.addDraftMember(resetPin,app.applicationId,id)).ok,true);
  assert.equal((await migratedActions.sendApplicationInvites(resetPin,app.applicationId)).ok,true);
  assert.equal(messages.length,4);
  const inviteUrl = new URL(messages[0].content.match(/https:\/\/[^\s]+/)[0]);
  assert.equal(inviteUrl.searchParams.get('t'),safety.eventId);
  assert.equal(inviteUrl.searchParams.get('g'),'1');
  const slotId = inviteUrl.searchParams.get('slot'); const token=inviteUrl.searchParams.get('token');
  assert.deepEqual(JSON.parse(JSON.stringify(await store.getMayhemInviteSelection(slotId))),resetPin);
  const decoy=await migratedActions.createMayhemEvent('Decoy');
  const decoyPin={eventId:decoy.eventId,generation:0};
  assert.equal((await migratedActions.setMayhemPublished(decoyPin,true)).ok,true);
  const applicationBefore=await snapshot();
  member={discordUserId:messages[0].id,displayName:'Invitee',avatarUrl:null};
  assert.equal((await migratedActions.confirmApplicationSlot(decoyPin,slotId,token)).ok,false);
  assert.equal((await migratedActions.declineApplicationSlot(decoyPin,slotId,token)).ok,false);
  assert.deepEqual(await snapshot(),applicationBefore);
  assert.equal((await migratedActions.confirmApplicationSlot(resetPin,slotId,token)).ok,true);
  member=null;
  assert.equal((await migratedActions.joinMayhemAsMember(resetPin,1)).ok,false);
  member={discordUserId:'123456789',displayName:'Member',avatarUrl:null};
  console.log('PASS: DM URLs and legacy slot lookup pin event/generation; wrong-event confirm/decline cannot alter another application.');
  await migratedActions.setMayhemPublished(decoyPin,false);
  await migratedActions.setRegistrationOpen(decoyPin,true);
  const draftBefore=await snapshot();
  const draftJoin=await migratedActions.joinMayhemAsMember(decoyPin,0);
  assert.equal(draftJoin.ok,false,'Unpublished event cannot accept public writes');
  assert.deepEqual(await snapshot(),draftBefore);
  console.log('PASS: unpublished drafts reject public self-service writes.');
  // Archive can win while a Discord call is in flight. Delivery bookkeeping
  // must re-lock/revalidate rather than silently mutate archived records.
  const race=await migratedActions.createMayhemEvent('Delivery race');
  const racePin={eventId:race.eventId,generation:0};
  await migratedActions.setMayhemPublished(racePin,true);
  await migratedActions.setTeamFormat(racePin,'premade');
  await migratedActions.setRegistrationOpen(racePin,true);
  const raceApp=await migratedActions.createPremadeApplication(racePin,'Race team',0);
  for (const id of ['300001','300002','300003','300004']) await migratedActions.addDraftMember(racePin,raceApp.applicationId,id);
  let archiveSnapshot;
  onDm=async()=>{ assert.equal((await migratedActions.archiveMayhemEvent(racePin)).ok,true);archiveSnapshot=await snapshot(); };
  const sendResult=await migratedActions.sendApplicationInvites(racePin,raceApp.applicationId);
  onDm=undefined;
  assert.equal(sendResult.ok,false);assert.match(sendResult.reason,/archived/);
  assert.deepEqual(await snapshot(),archiveSnapshot);
  console.log('PASS: Discord sends hold no transaction lock; archive during delivery prevents all subsequent bookkeeping writes.');
  const publicRoute=load('@/app/api/mayhem/state/route');
  const adminRoute=load('@/app/api/mayhem/admin-state/route');
  const request=q=>({url:`http://100.114.67.61:3001/api/mayhem/state${q}`});
  assert.equal((await publicRoute.GET(request('?t=missing'))).status,404);
  assert.equal((await publicRoute.GET(request(`?t=${decoy.eventId}`))).status,404);
  assert.equal((await publicRoute.GET(request(`?t=${race.eventId}`))).status,404);
  assert.equal((await publicRoute.GET(request(`?t=${safety.eventId}`))).data.event.id,safety.eventId);
  assert.equal((await adminRoute.GET(request(''))).status,400);
  assert.equal((await adminRoute.GET(request('?t=missing'))).status,404);
  assert.equal((await adminRoute.GET(request(`?t=${race.eventId}`))).data.event.id,race.eventId);
  authorized=false;
  assert.equal((await adminRoute.GET(request(`?t=${safety.eventId}`))).status,401);
  assert.equal((await publicRoute.GET(request(`?t=${decoy.eventId}&preview=1`))).status,401);
  authorized=true;
  assert.equal((await publicRoute.GET(request(`?t=${decoy.eventId}&preview=1`))).data.event.id,decoy.eventId);
  console.log('PASS: actual polling route handlers select exact events, reject missing/draft/archived public targets, and authenticate private preview/admin data.');
} finally { await db.close(); }
