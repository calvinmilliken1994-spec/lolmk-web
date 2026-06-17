import membersData from "@/data/members.json";
import type { Member } from "@/types/member";

const members = membersData as Member[];

export async function getMembers(): Promise<Member[]> {
  return members;
}

export async function getFeaturedMembers(): Promise<Member[]> {
  return members.filter((m) => m.featured);
}

export async function getMemberBySlug(slug: string): Promise<Member | null> {
  return members.find((m) => m.slug === slug) ?? null;
}
