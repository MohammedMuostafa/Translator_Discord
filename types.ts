export type DiscordUser = { id: string; username?: string };

export type DiscordAttachment = {
  id: string;
  filename: string;
  content_type?: string;
  size?: number;
  url: string;
  proxy_url?: string;
  flags?: number;
  duration_secs?: number;
  waveform?: string;
};

export type DiscordMessage = { id: string; content: string; attachments?: DiscordAttachment[] };

export type DiscordInteractionOption = {
  name: string;
  type: number;
  value?: string | boolean;
  options?: DiscordInteractionOption[];
  focused?: boolean;
};

export type DiscordComponent = {
  type: number;
  custom_id?: string;
  value?: string;
  components?: DiscordComponent[];
};

export type DiscordInteraction = {
  id: string;
  application_id: string;
  type: number;
  token: string;
  context?: number;
  guild_id?: string;
  channel_id?: string;
  member?: { user?: DiscordUser };
  user?: DiscordUser;
  data?: {
    id?: string;
    name?: string;
    type?: number;
    target_id?: string;
    custom_id?: string;
    component_type?: number;
    values?: string[];
    options?: DiscordInteractionOption[];
    components?: DiscordComponent[];
    resolved?: {
      messages?: Record<string, DiscordMessage>;
      attachments?: Record<string, DiscordAttachment>;
    };
  };
};
