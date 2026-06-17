export type InstagramMediaType = "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";

export interface InstagramSize {
  mediaUrl: string;
  width: number;
  height: number;
}

export interface InstagramPost {
  id: string;
  mediaType: InstagramMediaType;
  mediaUrl: string;
  thumbnailUrl?: string;
  permalink: string;
  caption?: string;
  prunedCaption?: string;
  timestamp: string;
  sizes?: {
    small?: InstagramSize;
    medium?: InstagramSize;
    large?: InstagramSize;
    full?: InstagramSize;
  };
}
