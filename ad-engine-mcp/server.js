import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const API_BASE = process.env.PINKCURVE_API_URL || 'https://ad-engine-api-610270819686.us-west1.run.app';
const PORT = process.env.PORT || 8080;

// Helper to format video ads response
function formatVideoAds(ads, limit = 6) {
    return (Array.isArray(ads) ? ads : ads.matches || [])
        .filter((ad) => ad.format === 'video' && ad.media_url)
        .slice(0, limit)
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
            intent_tags: ad.intent_tags,
        }));
}

function createServer() {
    const server = new McpServer({
        name: 'pinkcurve-video-ads',
        version: '2.0.0',
    });

    // Tool 1: Get featured video ads (no semantic search, just browse)
    server.tool(
        'get_featured_video_ads',
        'Get currently featured video ads from PinkCurve. Use this for browsing when the user has no specific intent.',
        {
            limit: z.number().int().min(1).max(20).optional().describe('Max number of video ads to return (default 10)'),
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
                const videoAds = formatVideoAds(ads, limit || 10);

                return {
                    content: [
                        {
                            type: 'text',
                            text: videoAds.length
                                ? JSON.stringify({ featured: true, count: videoAds.length, ads: videoAds }, null, 2)
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

    // Tool 2: Search video ads by buyer intent (semantic matching)
    server.tool(
        'search_video_ads_for_buyer',
        'Search PinkCurve video ads by buyer intent using semantic matching. Use this when the user describes what they are looking for.',
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
                const videoAds = formatVideoAds(ads, limit || 6);

                return {
                    content: [
                        {
                            type: 'text',
                            text: videoAds.length
                                ? JSON.stringify({ query, count: videoAds.length, ads: videoAds }, null, 2)
                                : `No video ads found matching "${query}".`,
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

    // Tool 3: Get ads by category
    server.tool(
        'get_video_ads_by_category',
        'Get video ads filtered by category. Use when user asks for a specific category like "Automotive" or "Fashion".',
        {
            category: z.string().describe('Category name (e.g., "Automotive", "Fashion & Apparel", "Jewelry & Accessories")'),
            limit: z.number().int().min(1).max(20).optional().describe('Max number of results (default 6)'),
        },
        async ({ category, limit }) => {
            try {
                const res = await fetch(`${API_BASE}/api/buyer/featured`);
                if (!res.ok) {
                    return {
                        content: [{ type: 'text', text: `Error fetching ads: ${res.status}` }],
                        isError: true,
                    };
                }
                const ads = await res.json();
                const videoAds = formatVideoAds(ads, 100)
                    .filter((ad) => ad.category?.toLowerCase().includes(category.toLowerCase()))
                    .slice(0, limit || 6);

                return {
                    content: [
                        {
                            type: 'text',
                            text: videoAds.length
                                ? JSON.stringify({ category, count: videoAds.length, ads: videoAds }, null, 2)
                                : `No video ads found in category "${category}".`,
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

    // Tool 4: Get ad details by ID
    server.tool(
        'get_ad_details',
        'Get detailed information about a specific ad by its ID.',
        {
            ad_id: z.string().uuid().describe('The UUID of the ad to retrieve'),
        },
        async ({ ad_id }) => {
            try {
                const res = await fetch(`${API_BASE}/api/buyer/featured`);
                if (!res.ok) {
                    return {
                        content: [{ type: 'text', text: `Error fetching ad: ${res.status}` }],
                        isError: true,
                    };
                }
                const ads = await res.json();
                const ad = ads.find((a) => a.id === ad_id);

                if (!ad) {
                    return {
                        content: [{ type: 'text', text: `Ad not found with ID: ${ad_id}` }],
                        isError: true,
                    };
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
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
                                intent_tags: ad.intent_tags,
                            }, null, 2),
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

    // Tool 5: List available categories
    server.tool(
        'list_categories',
        'List all available ad categories. Use to help users browse by category.',
        {},
        async () => {
            try {
                const res = await fetch(`${API_BASE}/api/buyer/categories`);
                if (!res.ok) {
                    return {
                        content: [{ type: 'text', text: `Error fetching categories: ${res.status}` }],
                        isError: true,
                    };
                }
                const categories = await res.json();

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ categories }, null, 2),
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
    console.log(`PinkCurve MCP server v2.0.0 running on port ${PORT}`);
});
