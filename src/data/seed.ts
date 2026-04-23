// Seed data for Your Internet Radio Dial
// All streams are real, publicly accessible. mp3 preferred; HLS noted.

export type StreamType = "mp3" | "aac" | "hls" | "ogg" | "unknown";

export interface Station {
  id: string;
  name: string;
  streamUrl: string;
  streamType: StreamType;
  homepage?: string;
  logoUrl?: string;
  country?: string;
  language?: string;
  bitrate?: number;
  tags?: string[];
  isPreset: boolean;
  /**
   * True (default) when the stream server returns permissive CORS headers.
   * False when it doesn't — the audio engine will route it via the
   * non-CORS element (no analyser / VU metering, but audio plays).
   */
  corsOk?: boolean;
}

export interface Group {
  id: string;
  name: string;
  position: number;
}

export interface Membership {
  stationId: string;
  groupId: string;
  position: number;
}

// --- groups ---
export const seedGroups: Group[] = [
  { id: "g-favorites", name: "Favorites", position: 0 },
  { id: "g-jazz", name: "Jazz", position: 1 },
  { id: "g-news", name: "News / Talk", position: 2 },
  { id: "g-ambient", name: "Ambient / Downtempo", position: 3 },
];

// --- stations ---
export const seedStations: Station[] = [
  // Favorites
  {
    id: "somafm-groove-salad",
    name: "SomaFM Groove Salad",
    streamUrl: "https://ice1.somafm.com/groovesalad-128-mp3",
    streamType: "mp3",
    homepage: "https://somafm.com/groovesalad/",
    country: "USA",
    language: "English",
    bitrate: 128,
    tags: ["downtempo", "ambient", "chillout"],
    isPreset: true,
  },
  {
    id: "kexp-seattle",
    name: "KEXP 90.3 Seattle",
    streamUrl: "https://kexp.streamguys1.com/kexp128.mp3",
    streamType: "mp3",
    homepage: "https://kexp.org",
    country: "USA",
    language: "English",
    bitrate: 128,
    tags: ["indie", "eclectic", "dj"],
    isPreset: true,
  },
  {
    id: "radio-paradise-main",
    name: "Radio Paradise — Main Mix",
    streamUrl: "https://stream.radioparadise.com/mp3-128",
    streamType: "mp3",
    homepage: "https://radioparadise.com",
    country: "USA",
    language: "English",
    bitrate: 128,
    tags: ["eclectic", "album rock"],
    isPreset: true,
  },
  {
    id: "fip",
    name: "FIP (Paris)",
    streamUrl: "https://icecast.radiofrance.fr/fip-midfi.mp3",
    streamType: "mp3",
    homepage: "https://www.radiofrance.fr/fip",
    country: "France",
    language: "French",
    bitrate: 128,
    tags: ["eclectic", "jazz", "world"],
    isPreset: true,
  },
  {
    id: "somafm-indie-pop-rocks",
    name: "SomaFM Indie Pop Rocks!",
    streamUrl: "https://ice1.somafm.com/indiepop-128-mp3",
    streamType: "mp3",
    homepage: "https://somafm.com/indiepop/",
    country: "USA",
    language: "English",
    bitrate: 128,
    tags: ["indie", "pop", "alternative"],
    isPreset: true,
  },
  {
    id: "somafm-lush",
    name: "SomaFM Lush",
    streamUrl: "https://ice1.somafm.com/lush-128-mp3",
    streamType: "mp3",
    homepage: "https://somafm.com/lush/",
    country: "USA",
    language: "English",
    bitrate: 128,
    tags: ["downtempo", "vocals", "chillout"],
    isPreset: true,
  },

  // Jazz
  {
    id: "jazz24",
    name: "Jazz24",
    // Current CDN per radio-browser.info (verified 2026-04-17).
    streamUrl: "https://knkx-live-a.edge.audiocdn.com/6285_128k",
    streamType: "mp3",
    homepage: "https://www.jazz24.org",
    country: "USA",
    language: "English",
    bitrate: 128,
    tags: ["jazz", "straight-ahead"],
    isPreset: true,
    corsOk: false,
  },
  {
    id: "somafm-sonic-universe",
    name: "SomaFM Sonic Universe",
    streamUrl: "https://ice1.somafm.com/sonicuniverse-128-mp3",
    streamType: "mp3",
    homepage: "https://somafm.com/sonicuniverse/",
    country: "USA",
    language: "English",
    bitrate: 128,
    tags: ["jazz", "avant-garde", "electronic jazz"],
    isPreset: true,
  },
  {
    id: "radio-swiss-jazz",
    name: "Radio Swiss Jazz",
    streamUrl: "https://stream.srg-ssr.ch/m/rsj/mp3_128",
    streamType: "mp3",
    homepage: "https://www.radioswissjazz.ch",
    country: "Switzerland",
    language: "English",
    bitrate: 128,
    tags: ["jazz", "classic jazz"],
    isPreset: true,
  },
  {
    id: "wfmu-freeform",
    name: "WFMU Freeform",
    streamUrl: "https://stream0.wfmu.org/freeform-128k.mp3",
    streamType: "mp3",
    homepage: "https://wfmu.org",
    country: "USA",
    language: "English",
    bitrate: 128,
    tags: ["freeform", "experimental", "eclectic"],
    isPreset: true,
    corsOk: false,
  },

  // News / Talk
  {
    id: "bbc-world-service",
    name: "BBC World Service",
    // MP3 Icecast direct — BBC's HLS redirector points to dead Akamai pools,
    // so we use the MP3 variant. Routes through /api/stream (non-CORS).
    // Per radio-browser.info (verified 2026-01-15, 15 845 votes).
    streamUrl: "https://stream.live.vc.bbcmedia.co.uk/bbc_world_service",
    streamType: "mp3",
    homepage: "https://www.bbc.co.uk/worldserviceradio",
    country: "UK",
    language: "English",
    bitrate: 56,
    tags: ["news", "talk", "world"],
    isPreset: true,
    corsOk: false,
  },
  {
    id: "abc-news-radio-au",
    name: "ABC News Radio (Australia)",
    // Non-HLS Icecast per radio-browser.info (verified 2026-01-15).
    streamUrl: "http://abc.streamguys1.com/live/newsradio/icecast.audio",
    streamType: "aac",
    homepage: "https://www.abc.net.au/news/newsradio/",
    country: "Australia",
    language: "English",
    bitrate: 56,
    tags: ["news", "talk", "world"],
    isPreset: true,
    corsOk: false,
  },
  {
    id: "npr-news",
    name: "NPR News",
    streamUrl: "https://npr-ice.streamguys1.com/live.mp3",
    streamType: "mp3",
    homepage: "https://www.npr.org",
    country: "USA",
    language: "English",
    bitrate: 128,
    tags: ["news", "talk"],
    isPreset: true,
  },
  {
    id: "kcrw-eclectic24",
    name: "KCRW Eclectic24",
    // Current path per radio-browser.info (verified 2026-01-14).
    streamUrl: "https://streams.kcrw.com/e24_mp3",
    streamType: "mp3",
    homepage: "https://www.kcrw.com",
    country: "USA",
    language: "English",
    bitrate: 192,
    tags: ["eclectic", "indie"],
    isPreset: true,
    corsOk: false,
  },
  {
    id: "wnyc-fm",
    name: "WNYC 93.9 FM",
    streamUrl: "https://fm939.wnyc.org/wnycfm",
    streamType: "mp3",
    homepage: "https://www.wnyc.org",
    country: "USA",
    language: "English",
    bitrate: 128,
    tags: ["news", "talk", "culture"],
    isPreset: true,
    corsOk: false,
  },

  // Ambient / Downtempo
  {
    id: "somafm-drone-zone",
    name: "SomaFM Drone Zone",
    streamUrl: "https://ice1.somafm.com/dronezone-128-mp3",
    streamType: "mp3",
    homepage: "https://somafm.com/dronezone/",
    country: "USA",
    language: "English",
    bitrate: 128,
    tags: ["ambient", "drone", "space"],
    isPreset: true,
  },
  {
    id: "somafm-deep-space-one",
    name: "SomaFM Deep Space One",
    streamUrl: "https://ice1.somafm.com/deepspaceone-128-mp3",
    streamType: "mp3",
    homepage: "https://somafm.com/deepspaceone/",
    country: "USA",
    language: "English",
    bitrate: 128,
    tags: ["ambient", "space", "electronic"],
    isPreset: true,
  },
  {
    id: "somafm-space-station",
    name: "SomaFM Space Station Soma",
    streamUrl: "https://ice1.somafm.com/spacestation-128-mp3",
    streamType: "mp3",
    homepage: "https://somafm.com/spacestation/",
    country: "USA",
    language: "English",
    bitrate: 128,
    tags: ["ambient", "downtempo", "electronic"],
    isPreset: true,
  },
  {
    id: "bluemars",
    name: "Echoes of Bluemars",
    // HTTP on :8000 — proxy fetches upstream server-side, so no mixed-content
    // issue in the browser.
    streamUrl: "http://streams.echoesofbluemars.org:8000/bluemars",
    streamType: "mp3",
    homepage: "https://echoesofbluemars.org",
    country: "USA",
    language: "English",
    bitrate: 128,
    tags: ["ambient", "space", "drone"],
    isPreset: true,
    corsOk: false,
  },
  {
    id: "somafm-mission-control",
    name: "SomaFM Mission Control",
    streamUrl: "https://ice1.somafm.com/missioncontrol-128-mp3",
    streamType: "mp3",
    homepage: "https://somafm.com/missioncontrol/",
    country: "USA",
    language: "English",
    bitrate: 128,
    tags: ["ambient", "space", "nasa"],
    isPreset: true,
  },
  {
    id: "radio-paradise-mellow",
    name: "Radio Paradise — Mellow Mix",
    streamUrl: "https://stream.radioparadise.com/mellow-128",
    streamType: "mp3",
    homepage: "https://radioparadise.com/mellow",
    country: "USA",
    language: "English",
    bitrate: 128,
    tags: ["mellow", "eclectic", "downtempo"],
    isPreset: true,
  },
];

// --- memberships (station -> group order) ---
export const seedMemberships: Membership[] = [
  // Favorites
  { stationId: "somafm-groove-salad", groupId: "g-favorites", position: 0 },
  { stationId: "kexp-seattle", groupId: "g-favorites", position: 1 },
  { stationId: "radio-paradise-main", groupId: "g-favorites", position: 2 },
  { stationId: "fip", groupId: "g-favorites", position: 3 },
  { stationId: "somafm-indie-pop-rocks", groupId: "g-favorites", position: 4 },
  { stationId: "somafm-lush", groupId: "g-favorites", position: 5 },

  // Jazz
  { stationId: "jazz24", groupId: "g-jazz", position: 0 },
  { stationId: "somafm-sonic-universe", groupId: "g-jazz", position: 1 },
  { stationId: "radio-swiss-jazz", groupId: "g-jazz", position: 2 },
  { stationId: "wfmu-freeform", groupId: "g-jazz", position: 3 },

  // News / Talk
  { stationId: "bbc-world-service", groupId: "g-news", position: 0 },
  { stationId: "abc-news-radio-au", groupId: "g-news", position: 1 },
  { stationId: "npr-news", groupId: "g-news", position: 2 },
  { stationId: "kcrw-eclectic24", groupId: "g-news", position: 3 },
  { stationId: "wnyc-fm", groupId: "g-news", position: 4 },

  // Ambient / Downtempo
  { stationId: "somafm-drone-zone", groupId: "g-ambient", position: 0 },
  { stationId: "somafm-deep-space-one", groupId: "g-ambient", position: 1 },
  { stationId: "somafm-space-station", groupId: "g-ambient", position: 2 },
  { stationId: "bluemars", groupId: "g-ambient", position: 3 },
  { stationId: "somafm-mission-control", groupId: "g-ambient", position: 4 },
  { stationId: "radio-paradise-mellow", groupId: "g-ambient", position: 5 },
];

export const seedDefaults = {
  activeGroupId: "g-favorites" as string,
  currentStationId: "somafm-groove-salad" as string,
  volume: 0.7,
};
