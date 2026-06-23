# PinkCurve Video Ads MCP Server

A public Model Context Protocol (MCP) server that lets any MCP-compatible AI assistant (Claude, etc.) retrieve and search video ads from PinkCurve (https://ad-engine-4da45.web.app), an AI-powered buyer-intent ad-matching platform.

## Public Server URL

https://ad-engine-mcp-610270819686.us-west1.run.app/mcp

No authentication required — this wraps PinkCurve's public buyer-facing ad endpoints.

## Connecting from an MCP Host

Add a remote MCP connector pointing to the URL above using the Streamable HTTP transport. In Claude.ai / Claude Desktop, this is typically done via Settings → Connectors → Add custom connector, pasting in the URL.

## Available Tools

### get_video_ads
Retrieve currently featured video ads from PinkCurve.

Parameters:
- limit (optional, integer, 1-20): max number of ads to return. Default 6.

Returns: JSON array of ads, each with id, headline, body_copy, video_url, thumbnail_url, product_title, price, currency, category, seller_name.

### search_video_ads
Search PinkCurve video ads by buyer intent using semantic matching.

Parameters:
- query (required, string): description of what the buyer is looking for (e.g. "wireless car diagnostics tool")
- limit (optional, integer, 1-20): max number of results. Default 6.

Returns: Same shape as get_video_ads.

## Architecture

This server is a thin wrapper: it calls PinkCurve's existing public API (ad-engine-api, the same backend powering the buyer search page at https://ad-engine-4da45.web.app/search) and reshapes the response for MCP tool calls. It runs as its own Cloud Run service, independent of the main API.

## Local Development

cd ad-engine-mcp
npm install
node server.js

Server listens on port 8080 by default (configurable via PORT env var). Set PINKCURVE_API_URL to point at a different backend (e.g. localhost during development).

## Deployment

gcloud run deploy ad-engine-mcp --source . --region=us-west1 --allow-unauthenticated
