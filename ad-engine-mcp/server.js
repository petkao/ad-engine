import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const API_BASE = process.env.PINKCURVE_API_URL || 'https://ad-engine-api-610270819686.us-west1.run.app';
const PORT = process.env.PORT || 8080;

function createServer() {
    const server = new McpServer({
        name: 'pinkcurve-video-ads',
        version: '1.0.0',
    });

    server.tool(
        'get_video_ads',
        'Retrieve current video ads from PinkCurve, an AI-powered buyer-intent ad-matching platform. Returns ad headline, video URL, thumbnail, product details, and seller info.',
        {
            limit: z.number().int().min(1).max(20).optional().describe('Max number of video ads to return (default 6)'),
        },
        async ({ limit }) => {
            try {
                const res = await fetch(`${API_BASE}/api/buyer/featured`);
                if (!res.ok) {
                    return {
                        content: [{ type: 'text', text: `Error fetching ads: ${res.status}` }],
                        isError: true,
                    };
                }
                const ads = await res.json();
                const videoAds = ads
                    .filter((ad) => ad.format === 'video' && ad.media_url)
                    .slice(0, limit || 6)
                    .map((ad) => ({
                        id: ad.id,
                        headline: ad.headline,
                        body_copy: ad.body_copy,
                        video_url: ad.media_url,
                        thumbnail_url: ad.thumbnail_url,
                        product_title: ad.product_title,
                        price: ad.price,
                        currency: ad.currency,
                        category: ad.category,
                        seller_name: ad.seller_name,
                    }));

                return {
                    content: [
                        {
                            type: 'text',
                            text: videoAds.length
                                ? JSON.stringify(videoAds, null, 2)
                                : 'No video ads currently available.',
                        },
                    ],
                };
            } catch (err) {
                return {
                    content: [{ type: 'text', text: `Error: ${err.message}` }],
                    isError: true,
                };
            }
        }
    );

    server.tool(
        'search_video_ads',
        'Search PinkCurve video ads by buyer intent/search query using semantic matching.',
        {
            query: z.string().describe('Search query describing what the buyer is looking for'),
            limit: z.number().int().min(1).max(20).optional().describe('Max number of results (default 6)'),
        },
        async ({ query, limit }) => {
            try {
                const res = await fetch(`${API_BASE}/api/buyer/semantic-match`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query }),
                });
                if (!res.ok) {
                    return {
                        content: [{ type: 'text', text: `Error fetching ads: ${res.status}` }],
                        isError: true,
                    };
                }
                const ads = await res.json();
                const videoAds = (Array.isArray(ads) ? ads : ads.matches || [])
                    .filter((ad) => ad.format === 'video' && ad.media_url)
                    .slice(0, limit || 6)
                    .map((ad) => ({
                        id: ad.id,
                        headline: ad.headline,
                        body_copy: ad.body_copy,
                        video_url: ad.media_url,
                        thumbnail_url: ad.thumbnail_url,
                        product_title: ad.product_title,
                        price: ad.price,
                        currency: ad.currency,
                        category: ad.category,
                        seller_name: ad.seller_name,
                    }));

                return {
                    content: [
                        {
                            type: 'text',
                            text: videoAds.length
                                ? JSON.stringify(videoAds, null, 2)
                                : 'No matching video ads found.',
                        },
                    ],
                };
            } catch (err) {
                return {
                    content: [{ type: 'text', text: `Error: ${err.message}` }],
                    isError: true,
                };
            }
        }
    );

    return server;
}

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/mcp', async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
    });
    res.on('close', () => {
        transport.close();
        server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
});

app.listen(PORT, () => {
    console.log(`PinkCurve MCP server running on port ${PORT}`);
});