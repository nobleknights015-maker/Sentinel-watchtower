# Sentinel Watchtower

Sentinel is Bearframe Labs' independent Discord/community intelligence system.

> Different department. Same objective.

## What v0.1 does

- Connects as a proper Discord bot through the Gateway.
- Replies when mentioned; it does not impersonate a user account or require a user token.
- Uses OpenAI's Responses API for Sentinel's conversational intelligence.
- Stores bounded recent context only in administrator-approved watched channels.
- Caps retained channel context at 200 messages per watched channel.
- Lets each member opt out of passive retention.
- Lets each member delete their retained messages and explicit memories.
- Supports explicit personal memories via `/sentinel remember`.
- Keeps watched-channel configuration restricted to members with Manage Server.
- Provides `/health` for hosting checks.

## Discord setup

Create an application at the Discord Developer Portal, add a Bot user, and copy the bot token directly into your host's secret/environment settings. **Never paste the bot token into chat or commit it to Git.**

Enable the **Message Content** privileged intent if you want Watchtower context retention and mention-based natural conversation.

Recommended bot permissions for the first deployment:

- View Channels
- Send Messages
- Read Message History
- Use Application Commands

Do not give Sentinel Administrator unless a future feature genuinely requires it.

## Required environment variables

- `DISCORD_BOT_TOKEN`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `DATABASE_URL`
- `PORT`
- `DISCORD_DEV_GUILD_ID` — optional

## Commands

- `/sentinel status`
- `/sentinel remember note:<text>`
- `/sentinel privacy mode:Opt out|Opt in`
- `/sentinel delete-my-data`
- `/sentinel watch` — Manage Server only
- `/sentinel unwatch` — Manage Server only

## Data model

Watchtower stores server IDs, channel IDs, Discord user IDs, display names, bounded message content from watched channels, explicit user-provided memories, and privacy preferences. This v0.1 deliberately does **not** scrape DMs, presence, member lists, attachments, or unrelated channels.

The runtime should be paired with a public Privacy Policy and Terms of Service before broad distribution.

## Hosting

A Discord Gateway client needs a continuously running host. Render can run the worker; choose the hosting plan deliberately rather than committing billing changes by accident.
