export interface Video {
  id: string;
  title: string;
  slug: string;
  description: string;
  duration: number;
  source_path: string | null;
  thumbnail_path: string | null;
  manifest_path: string | null;
  preview_start_time: number | null;
  // Resolved URLs (from backend, ready to use directly)
  thumbnail_url: string;
  manifest_url: string;
  status: "uploading" | "processing" | "ready" | "failed" | "deleted";
  content_classification: "safe" | "mature" | "explicit";
  min_tier_level: number;
  view_count: number;
  is_featured: boolean;
  tags: string[];
  imdb_rating: number | null;
  rotten_tomatoes_score: number | null;
  metacritic_score: number | null;
  external_metadata: Record<string, unknown>;
  published_at: string | null;
  file_size: number;
  original_filename: string | null;
  source_width: number | null;
  source_height: number | null;
  created_at: string;
  updated_at: string;
  // Episode info
  series_id: string | null;
  season_id: string | null;
  episode_number: number | null;
  // Categories
  category_ids?: string[];
  tenant_ids?: string[];
  // Relations
  qualities?: VideoQuality[];
  audio_tracks?: AudioTrack[];
  subtitle_tracks?: SubtitleTrack[];
  talents?: VideoTalentLink[];
  access?: ContentAccess;
}

export interface VideoQuality {
  id: string;
  quality_name: string;
  width: number;
  height: number;
  bitrate: number;
}

export interface AudioTrack {
  id: string;
  language: string;
  label: string;
  is_default: boolean;
}

export interface SubtitleTrack {
  id: string;
  language: string;
  label: string;
  format: string;
  file_path: string;
  file_url: string;
  is_default: boolean;
}

export interface VideoTalentLink {
  talent_id: string;
  role: string;
  talent?: Talent;
}

export interface Talent {
  id: string;
  name: string;
  slug: string;
  bio: string;
  photo_url: string;
  birth_date: string | null;
  created_at?: string;
  updated_at?: string;
  video_count?: number;
}

export interface Series {
  id: string;
  title: string;
  slug: string;
  description: string;
  poster_url: string;
  banner_url: string;
  content_classification: string;
  status: "ongoing" | "completed" | "cancelled";
  year_started: number | null;
  tags: string[];
  created_at?: string;
  updated_at?: string;
  seasons?: Season[];
}

export interface Season {
  id: string;
  series_id?: string;
  season_number: number;
  title: string;
  description: string;
  poster_url: string;
  created_at?: string;
  episodes?: Video[];
}

export interface Category {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  description: string;
  sort_order: number;
}

export interface Competition {
  id: string;
  tenant_id: string;
  category_id: string;
  category_name: string;
  name: string;
  slug: string;
  description: string;
  logo_url: string;
  competition_type: string;
  season: string | null;
  year: number | null;
  status: "upcoming" | "active" | "completed";
  start_date: string | null;
  end_date: string | null;
  event_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface SportEvent {
  id: string;
  tenant_id: string;
  competition_id: string;
  competition_name: string;
  title: string;
  slug: string;
  description: string;
  event_type: string;
  round_label: string;
  participant_1: string;
  participant_2: string;
  venue: string;
  scheduled_at: string;
  status: "scheduled" | "live" | "completed" | "cancelled" | "postponed";
  score_1: number | null;
  score_2: number | null;
  result_data: Record<string, unknown> | null;
  live_stream_id: string | null;
  replay_video_id: string | null;
  highlight_count: number;
  created_at: string | null;
  updated_at: string | null;
  highlights?: EventHighlight[];
}

export interface EventHighlight {
  id: string;
  event_id: string;
  video_id: string;
  title: string;
  timestamp_in_event: number | null;
  highlight_type: string;
  sort_order: number;
  video_title: string;
  video_duration: number;
  created_at: string | null;
}

export interface ContentAccess {
  has_access: boolean;
  reason: string;
  min_tier_level?: number;
  current_tier_level?: number;
}

export interface LiveStream {
  id: string;
  title: string;
  description: string;
  status: "idle" | "live" | "ended";
  category_id: string | null;
  category_name: string;
  manifest_url: string;
  thumbnail_url: string;
  viewer_count: number;
  started_at: string | null;
  is_ppv: boolean;
  ppv_price: string | null;
  ppv_currency: string;
  access?: ContentAccess;
}

export interface LiveStreamAdmin extends LiveStream {
  stream_key: string;
  peak_viewers: number;
  tenant_id: string;
  created_by: string | null;
  ended_at: string | null;
  is_ppv: boolean;
  ppv_price: string | null;
  ppv_currency: string;
  created_at: string;
  updated_at: string;
}

export interface LiveStreamCreated {
  id: string;
  title: string;
  stream_key: string;
  rtmp_url: string;
  status: string;
}

export interface ChatMessage {
  type: "message" | "system" | "viewer_count" | "error" | "pong";
  username?: string;
  content?: string;
  viewer_count?: number;
  timestamp?: string;
}

export interface TenantConfig {
  id?: string;
  slug: string;
  site_name: string;
  description: string;
  logo_url: string;
  favicon_url: string;
  primary_color: string;
  secondary_color: string;
  background_color: string;
  features: Record<string, boolean>;
  max_content_level: string;
  age_verification: "none" | "click_through" | "date_of_birth";
}

export interface User {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url: string;
  role: "viewer" | "admin" | "superadmin";
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface WatchlistItem {
  id: string;
  video_id: string;
  added_at: string;
  video: Video | null;
}

export interface ReactionResponse {
  user_reaction: "like" | "dislike" | null;
}

export interface WatchProgressMap {
  [videoId: string]: { progress: number; duration: number; percentage: number; watch_count?: number };
}

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url: string;
  role: "viewer" | "admin" | "superadmin";
  auth_provider: string;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string | null;
}

export interface AdminTenant {
  id: string;
  slug: string;
  domain: string;
  site_name: string;
  description: string;
  logo_url: string;
  favicon_url: string;
  primary_color: string;
  secondary_color: string;
  background_color: string;
  features: Record<string, boolean>;
  max_content_level: string;
  age_verification: string;
  content_rating_system: string;
  default_content_rating: string;
  subscriptions_enabled: boolean;
  is_active: boolean;
  maintenance_mode: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface AnalyticsOverview {
  total_users: number;
  total_videos: number;
  total_views: number;
  total_storage_bytes: number;
  active_streams: number;
  videos_by_status: { ready: number; processing: number; failed: number };
  users_by_role: Record<string, number>;
  recent_videos: { id: string; title: string; status: string; view_count: number; created_at: string | null }[];
  recent_users: { id: string; username: string; email: string; role: string; created_at: string | null }[];
}
