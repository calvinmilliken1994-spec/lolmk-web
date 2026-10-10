import Image from "next/image";
import { cn } from "@/lib/utils";
import { discordAvatarUrl } from "@/lib/member-display";

/**
 * MemberCard: the Members directory card, reused by the Locker profile.
 *
 * Top-right chamfer. The art zone shows the splash of the member's main
 * champion (Riot Data Dragon, used under Riot's Legal Jibber Jabber policy;
 * the notice is in the footer) behind a chamfered Discord avatar. Below:
 * display name in Bebas 36px, Riot ID as a dim secondary line, role chips,
 * tagline, and "Mains <champion>". Every line is omitted when unknown.
 */

export interface MemberCardData {
  displayName: string;
  riotId: string | null;
  avatarUrl: string | null;
  bio: string;
  preferredRoles: string[];
  /** Data Dragon id, e.g. "MonkeyKing". */
  championId: string | null;
  /** Display name, e.g. "Wukong". Falls back to the id. */
  championName: string | null;
}

export function splashUrl(championId: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${encodeURIComponent(championId)}_0.jpg`;
}

const ROLE_LABEL: Record<string, string> = {
  TOP: "Top",
  JUNGLE: "Jungle",
  MID: "Mid",
  ADC: "ADC",
  SUPPORT: "Support",
  FILL: "Fill",
};

export function MemberCard({ member, className }: { member: MemberCardData; className?: string }) {
  const avatar = member.avatarUrl ? discordAvatarUrl(member.avatarUrl, 256) ?? member.avatarUrl : null;
  return (
    <article
      className={cn(
        "cut-plate flex min-w-0 flex-col border border-ds-line bg-ds-surface transition-[transform,border-color] duration-base ease-ds hover:-translate-y-1 hover:border-ds-line-strong motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        className,
      )}
    >
      <div className="relative h-[150px]">
        <div className="texture-art absolute inset-0 overflow-hidden bg-ds-surface-2">
          {member.championId && (
            <Image
              src={splashUrl(member.championId)}
              alt=""
              fill
              sizes="(min-width: 1024px) 300px, (min-width: 640px) 45vw, 90vw"
              className="object-cover object-[center_20%] opacity-60"
            />
          )}
          <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-ds-surface via-ds-surface/30 to-transparent" />
        </div>
        <div className="absolute bottom-0 left-6 z-10 translate-y-1/2">
          {avatar ? (
            <Image
              src={avatar}
              alt=""
              width={88}
              height={88}
              className="cut-avatar h-[88px] w-[88px] border-0 bg-ds-surface-2 object-cover"
            />
          ) : (
            <span
              aria-hidden
              className="cut-avatar flex h-[88px] w-[88px] items-center justify-center bg-ds-line-soft font-display text-[40px] leading-none text-ds-text"
            >
              {member.displayName.slice(0, 1)}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-auto flex-col gap-3 px-6 pb-6 pt-14">
        <div className="min-w-0">
          <h3 className="m-0 truncate font-display text-[36px] font-normal leading-[0.95] text-white" title={member.displayName}>
            {member.displayName}
          </h3>
          {member.riotId && (
            <p className="m-0 mt-1 truncate font-heading text-ds-label text-ds-text-dim">{member.riotId}</p>
          )}
        </div>
        {member.preferredRoles.length > 0 && (
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {member.preferredRoles.map((r) => (
              <li
                key={r}
                className="inline-flex min-h-7 items-center bg-ds-line-soft px-2.5 font-heading text-ds-label font-semibold text-[#C9D0E3]"
              >
                {ROLE_LABEL[r] ?? r}
              </li>
            ))}
          </ul>
        )}
        {member.bio && <p className="m-0 line-clamp-3 text-ds-body text-ds-text-muted">{member.bio}</p>}
        {member.championId && (
          <p className="m-0 mt-auto border-t border-ds-line-soft pt-3 font-heading text-ds-ui text-ds-text-dim">
            Mains <span className="font-semibold text-ds-text">{member.championName ?? member.championId}</span>
          </p>
        )}
      </div>
    </article>
  );
}
