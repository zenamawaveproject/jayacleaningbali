// functions/api/site.js

const SESSION_COOKIE = "jaya_admin_session";

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    try {
        /*
        |--------------------------------------------------------------------------
        | GET /api/site
        |--------------------------------------------------------------------------
        | Mengambil seluruh data utama website untuk frontend.
        */
        if (
            request.method === "GET" &&
            url.pathname === "/api/site"
        ) {
            return await getSite(env);
        }


        /*
        |--------------------------------------------------------------------------
        | GET /api/site/settings
        |--------------------------------------------------------------------------
        */
        if (
            request.method === "GET" &&
            url.pathname === "/api/site/settings"
        ) {
            return await getSettings(env);
        }


        /*
        |--------------------------------------------------------------------------
        | GET /api/site/content
        |--------------------------------------------------------------------------
        */
        if (
            request.method === "GET" &&
            url.pathname === "/api/site/content"
        ) {
            return await getContent(env);
        }


        /*
        |--------------------------------------------------------------------------
        | GET /api/site/navigation
        |--------------------------------------------------------------------------
        */
        if (
            request.method === "GET" &&
            url.pathname === "/api/site/navigation"
        ) {
            return await getNavigation(env);
        }


        /*
        |--------------------------------------------------------------------------
        | PUT /api/site/settings
        |--------------------------------------------------------------------------
        */
        if (
            request.method === "PUT" &&
            url.pathname === "/api/site/settings"
        ) {
            return await updateSettings(request, env);
        }


        /*
        |--------------------------------------------------------------------------
        | PUT /api/site/content
        |--------------------------------------------------------------------------
        */
        if (
            request.method === "PUT" &&
            url.pathname === "/api/site/content"
        ) {
            return await updateContent(request, env);
        }


        /*
        |--------------------------------------------------------------------------
        | POST /api/site/navigation
        |--------------------------------------------------------------------------
        */
        if (
            request.method === "POST" &&
            url.pathname === "/api/site/navigation"
        ) {
            return await createNavigation(request, env);
        }


        /*
        |--------------------------------------------------------------------------
        | Navigation ID routes
        |--------------------------------------------------------------------------
        */

        const navigationMatch = url.pathname.match(
            /^\/api\/site\/navigation\/(\d+)$/
        );

        if (navigationMatch) {
            const navigationId = Number(navigationMatch[1]);

            if (!Number.isInteger(navigationId) || navigationId <= 0) {
                return jsonResponse(
                    {
                        success: false,
                        message: "ID navigation tidak valid."
                    },
                    400
                );
            }

            if (request.method === "PUT") {
                return await updateNavigation(
                    request,
                    env,
                    navigationId
                );
            }

            if (request.method === "DELETE") {
                return await deleteNavigation(
                    request,
                    env,
                    navigationId
                );
            }
        }


        return jsonResponse(
            {
                success: false,
                message: "Endpoint tidak ditemukan."
            },
            404
        );

    } catch (error) {
        console.error("SITE API ERROR:", error);

        return jsonResponse(
            {
                success: false,
                message: "Terjadi kesalahan pada server."
            },
            500
        );
    }
}


/*
|--------------------------------------------------------------------------
| GET SITE
|--------------------------------------------------------------------------
*/

async function getSite(env) {
    const settings = await env.DB
        .prepare(`
            SELECT
                id,
                site_name,
                tagline,
                description,
                phone,
                whatsapp,
                email,
                address,
                city,
                province,
                google_maps_url,
                instagram_url,
                facebook_url,
                tiktok_url,
                youtube_url,
                logo_media_id,
                favicon_media_id,
                og_image_media_id,
                meta_title,
                meta_description,
                meta_keywords,
                robots_index,
                robots_follow,
                google_verification,
                schema_org_enabled,
                business_type,
                opening_hours,
                updated_at
            FROM site_settings
            WHERE id = 1
            LIMIT 1
        `)
        .first();

    const content = await env.DB
        .prepare(`
            SELECT
                id,
                about_title,
                about_text,
                about_image_media_id,
                why_title,
                why_text,
                process_title,
                process_text,
                gallery_title,
                gallery_text,
                faq_title,
                faq_text,
                cta_title,
                cta_text,
                cta_button_text,
                cta_button_url,
                updated_at
            FROM site_content
            WHERE id = 1
            LIMIT 1
        `)
        .first();

    const navigation = await env.DB
        .prepare(`
            SELECT
                id,
                label,
                url,
                target,
                sort_order
            FROM navigation
            WHERE is_active = 1
            ORDER BY sort_order ASC, id ASC
        `)
        .all();

    return jsonResponse({
        success: true,
        data: {
            settings: settings || null,
            content: content || null,
            navigation: navigation.results || []
        }
    });
}


/*
|--------------------------------------------------------------------------
| GET SETTINGS
|--------------------------------------------------------------------------
*/

async function getSettings(env) {
    const settings = await env.DB
        .prepare(`
            SELECT
                id,
                site_name,
                tagline,
                description,
                phone,
                whatsapp,
                email,
                address,
                city,
                province,
                google_maps_url,
                instagram_url,
                facebook_url,
                tiktok_url,
                youtube_url,
                logo_media_id,
                favicon_media_id,
                og_image_media_id,
                meta_title,
                meta_description,
                meta_keywords,
                robots_index,
                robots_follow,
                google_verification,
                schema_org_enabled,
                business_type,
                opening_hours,
                updated_at
            FROM site_settings
            WHERE id = 1
            LIMIT 1
        `)
        .first();

    return jsonResponse({
        success: true,
        data: settings || null
    });
}


/*
|--------------------------------------------------------------------------
| GET CONTENT
|--------------------------------------------------------------------------
*/

async function getContent(env) {
    const content = await env.DB
        .prepare(`
            SELECT
                id,
                about_title,
                about_text,
                about_image_media_id,
                why_title,
                why_text,
                process_title,
                process_text,
                gallery_title,
                gallery_text,
                faq_title,
                faq_text,
                cta_title,
                cta_text,
                cta_button_text,
                cta_button_url,
                updated_at
            FROM site_content
            WHERE id = 1
            LIMIT 1
        `)
        .first();

    return jsonResponse({
        success: true,
        data: content || null
    });
}


/*
|--------------------------------------------------------------------------
| GET NAVIGATION
|--------------------------------------------------------------------------
*/

async function getNavigation(env) {
    const navigation = await env.DB
        .prepare(`
            SELECT
                id,
                label,
                url,
                target,
                sort_order,
                is_active
            FROM navigation
            WHERE is_active = 1
            ORDER BY sort_order ASC, id ASC
        `)
        .all();

    return jsonResponse({
        success: true,
        data: navigation.results || []
    });
}


/*
|--------------------------------------------------------------------------
| UPDATE SETTINGS
|--------------------------------------------------------------------------
*/

async function updateSettings(request, env) {
    const auth = await requireAdmin(request, env);

    if (!auth.authenticated) {
        return auth.response;
    }

    const body = await readJson(request);

    if (!body) {
        return jsonResponse(
            {
                success: false,
                message: "Data JSON tidak valid."
            },
            400
        );
    }

    const fields = [
        "site_name",
        "tagline",
        "description",
        "phone",
        "whatsapp",
        "email",
        "address",
        "city",
        "province",
        "google_maps_url",
        "instagram_url",
        "facebook_url",
        "tiktok_url",
        "youtube_url",
        "logo_media_id",
        "favicon_media_id",
        "og_image_media_id",
        "meta_title",
        "meta_description",
        "meta_keywords",
        "robots_index",
        "robots_follow",
        "google_verification",
        "schema_org_enabled",
        "business_type",
        "opening_hours"
    ];

    const updates = [];
    const values = [];

    for (const field of fields) {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
            updates.push(`${field} = ?`);
            values.push(normalizeValue(field, body[field]));
        }
    }

    if (updates.length === 0) {
        return jsonResponse(
            {
                success: false,
                message: "Tidak ada data yang diperbarui."
            },
            400
        );
    }

    updates.push("updated_at = CURRENT_TIMESTAMP");

    await env.DB
        .prepare(`
            UPDATE site_settings
            SET ${updates.join(", ")}
            WHERE id = 1
        `)
        .bind(...values)
        .run();

    const settings = await env.DB
        .prepare(`
            SELECT *
            FROM site_settings
            WHERE id = 1
            LIMIT 1
        `)
        .first();

    return jsonResponse({
        success: true,
        message: "Pengaturan website berhasil diperbarui.",
        data: settings
    });
}


/*
|--------------------------------------------------------------------------
| UPDATE CONTENT
|--------------------------------------------------------------------------
*/

async function updateContent(request, env) {
    const auth = await requireAdmin(request, env);

    if (!auth.authenticated) {
        return auth.response;
    }

    const body = await readJson(request);

    if (!body) {
        return jsonResponse(
            {
                success: false,
                message: "Data JSON tidak valid."
            },
            400
        );
    }

    const fields = [
        "about_title",
        "about_text",
        "about_image_media_id",
        "why_title",
        "why_text",
        "process_title",
        "process_text",
        "gallery_title",
        "gallery_text",
        "faq_title",
        "faq_text",
        "cta_title",
        "cta_text",
        "cta_button_text",
        "cta_button_url"
    ];

    const updates = [];
    const values = [];

    for (const field of fields) {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
            updates.push(`${field} = ?`);
            values.push(normalizeValue(field, body[field]));
        }
    }

    if (updates.length === 0) {
        return jsonResponse(
            {
                success: false,
                message: "Tidak ada data yang diperbarui."
            },
            400
        );
    }

    updates.push("updated_at = CURRENT_TIMESTAMP");

    await env.DB
        .prepare(`
            UPDATE site_content
            SET ${updates.join(", ")}
            WHERE id = 1
        `)
        .bind(...values)
        .run();

    const content = await env.DB
        .prepare(`
            SELECT *
            FROM site_content
            WHERE id = 1
            LIMIT 1
        `)
        .first();

    return jsonResponse({
        success: true,
        message: "Konten website berhasil diperbarui.",
        data: content
    });
}


/*
|--------------------------------------------------------------------------
| CREATE NAVIGATION
|--------------------------------------------------------------------------
*/

async function createNavigation(request, env) {
    const auth = await requireAdmin(request, env);

    if (!auth.authenticated) {
        return auth.response;
    }

    const body = await readJson(request);

    if (!body) {
        return jsonResponse(
            {
                success: false,
                message: "Data JSON tidak valid."
            },
            400
        );
    }

    const label = cleanString(body.label);
    const url = cleanString(body.url);
    const target = cleanString(body.target) || "_self";
    const sortOrder = Number(body.sort_order || 0);
    const isActive = body.is_active === false ? 0 : 1;

    if (!label || !url) {
        return jsonResponse(
            {
                success: false,
                message: "Label dan URL wajib diisi."
            },
            400
        );
    }

    if (!["_self", "_blank"].includes(target)) {
        return jsonResponse(
            {
                success: false,
                message: "Target navigation tidak valid."
            },
            400
        );
    }

    const result = await env.DB
        .prepare(`
            INSERT INTO navigation (
                label,
                url,
                target,
                sort_order,
                is_active
            )
            VALUES (?, ?, ?, ?, ?)
        `)
        .bind(
            label,
            url,
            target,
            Number.isFinite(sortOrder) ? sortOrder : 0,
            isActive
        )
        .run();

    const navigation = await env.DB
        .prepare(`
            SELECT *
            FROM navigation
            WHERE id = ?
            LIMIT 1
        `)
        .bind(result.meta.last_row_id)
        .first();

    return jsonResponse(
        {
            success: true,
            message: "Menu berhasil ditambahkan.",
            data: navigation
        },
        201
    );
}


/*
|--------------------------------------------------------------------------
| UPDATE NAVIGATION
|--------------------------------------------------------------------------
*/

async function updateNavigation(request, env, id) {
    const auth = await requireAdmin(request, env);

    if (!auth.authenticated) {
        return auth.response;
    }

    const body = await readJson(request);

    if (!body) {
        return jsonResponse(
            {
                success: false,
                message: "Data JSON tidak valid."
            },
            400
        );
    }

    const allowedFields = [
        "label",
        "url",
        "target",
        "sort_order",
        "is_active"
    ];

    const updates = [];
    const values = [];

    for (const field of allowedFields) {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
            let value = body[field];

            if (field === "label" || field === "url") {
                value = cleanString(value);
            }

            if (field === "target") {
                value = cleanString(value);

                if (!["_self", "_blank"].includes(value)) {
                    return jsonResponse(
                        {
                            success: false,
                            message: "Target navigation tidak valid."
                        },
                        400
                    );
                }
            }

            if (field === "sort_order") {
                value = Number(value);

                if (!Number.isFinite(value)) {
                    value = 0;
                }
            }

            if (field === "is_active") {
                value = value ? 1 : 0;
            }

            updates.push(`${field} = ?`);
            values.push(value);
        }
    }

    if (updates.length === 0) {
        return jsonResponse(
            {
                success: false,
                message: "Tidak ada data yang diperbarui."
            },
            400
        );
    }

    updates.push("updated_at = CURRENT_TIMESTAMP");

    values.push(id);

    const result = await env.DB
        .prepare(`
            UPDATE navigation
            SET ${updates.join(", ")}
            WHERE id = ?
        `)
        .bind(...values)
        .run();

    if (!result.meta.changes) {
        return jsonResponse(
            {
                success: false,
                message: "Menu tidak ditemukan."
            },
            404
        );
    }

    const navigation = await env.DB
        .prepare(`
            SELECT *
            FROM navigation
            WHERE id = ?
            LIMIT 1
        `)
        .bind(id)
        .first();

    return jsonResponse({
        success: true,
        message: "Menu berhasil diperbarui.",
        data: navigation
    });
}


/*
|--------------------------------------------------------------------------
| DELETE NAVIGATION
|--------------------------------------------------------------------------
*/

async function deleteNavigation(request, env, id) {
    const auth = await requireAdmin(request, env);

    if (!auth.authenticated) {
        return auth.response;
    }

    const result = await env.DB
        .prepare(`
            DELETE FROM navigation
            WHERE id = ?
        `)
        .bind(id)
        .run();

    if (!result.meta.changes) {
        return jsonResponse(
            {
                success: false,
                message: "Menu tidak ditemukan."
            },
            404
        );
    }

    return jsonResponse({
        success: true,
        message: "Menu berhasil dihapus."
    });
}


/*
|--------------------------------------------------------------------------
| ADMIN AUTH CHECK
|--------------------------------------------------------------------------
|
| Session dibuat oleh auth.js.
| Di sini kita memverifikasi token yang sama.
|
*/

async function requireAdmin(request, env) {
    if (!env.AUTH_SECRET) {
        return {
            authenticated: false,
            response: jsonResponse(
                {
                    success: false,
                    message: "AUTH_SECRET belum dikonfigurasi."
                },
                500
            )
        };
    }

    const cookies = parseCookies(
        request.headers.get("Cookie") || ""
    );

    const token = cookies[SESSION_COOKIE];

    if (!token) {
        return {
            authenticated: false,
            response: jsonResponse(
                {
                    success: false,
                    message: "Anda harus login terlebih dahulu."
                },
                401
            )
        };
    }

    const session = await verifySessionToken(
        token,
        env.AUTH_SECRET
    );

    if (!session) {
        return {
            authenticated: false,
            response: jsonResponse(
                {
                    success: false,
                    message: "Session tidak valid atau sudah kedaluwarsa."
                },
                401
            )
        };
    }

    const admin = await env.DB
        .prepare(`
            SELECT
                id,
                username,
                name,
                email,
                role,
                is_active
            FROM admins
            WHERE id = ?
            LIMIT 1
        `)
        .bind(session.id)
        .first();

    if (!admin || Number(admin.is_active) !== 1) {
        return {
            authenticated: false,
            response: jsonResponse(
                {
                    success: false,
                    message: "Akun admin tidak aktif."
                },
                401
            )
        };
    }

    return {
        authenticated: true,
        admin
    };
}


/*
|--------------------------------------------------------------------------
| SESSION VERIFICATION
|--------------------------------------------------------------------------
*/

async function verifySessionToken(token, secret) {
    try {
        const parts = token.split(".");

        if (parts.length !== 2) {
            return null;
        }

        const encodedPayload = parts[0];
        const signature = parts[1];

        const expectedSignature = await signHmac(
            encodedPayload,
            secret
        );

        if (
            !constantTimeEqual(
                signature,
                expectedSignature
            )
        ) {
            return null;
        }

        const payloadBytes = base64UrlDecode(
            encodedPayload
        );

        const payload = JSON.parse(
            new TextDecoder().decode(payloadBytes)
        );

        const now = Math.floor(Date.now() / 1000);

        if (!payload.exp || now >= payload.exp) {
            return null;
        }

        if (!payload.id) {
            return null;
        }

        return payload;

    } catch {
        return null;
    }
}


/*
|--------------------------------------------------------------------------
| HMAC SHA-256
|--------------------------------------------------------------------------
*/

async function signHmac(message, secret) {
    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        {
            name: "HMAC",
            hash: "SHA-256"
        },
        false,
        ["sign"]
    );

    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(message)
    );

    return base64UrlEncode(
        new Uint8Array(signature)
    );
}


/*
|--------------------------------------------------------------------------
| JSON BODY
|--------------------------------------------------------------------------
*/

async function readJson(request) {
    try {
        return await request.json();
    } catch {
        return null;
    }
}


/*
|--------------------------------------------------------------------------
| NORMALIZE
|--------------------------------------------------------------------------
*/

function normalizeValue(field, value) {
    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }

    if (
        field === "logo_media_id" ||
        field === "favicon_media_id" ||
        field === "og_image_media_id" ||
        field === "about_image_media_id"
    ) {
        if (value === "" || value === null) {
            return null;
        }

        const number = Number(value);

        return Number.isInteger(number)
            ? number
            : null;
    }

    if (
        field === "robots_index" ||
        field === "robots_follow" ||
        field === "schema_org_enabled"
    ) {
        return value ? 1 : 0;
    }

    if (typeof value === "string") {
        return value.trim();
    }

    return value;
}


function cleanString(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    return String(value).trim();
}


/*
|--------------------------------------------------------------------------
| COOKIE
|--------------------------------------------------------------------------
*/

function parseCookies(cookieHeader) {
    const cookies = {};

    cookieHeader
        .split(";")
        .forEach(part => {
            const index = part.indexOf("=");

            if (index === -1) {
                return;
            }

            const name = part
                .slice(0, index)
                .trim();

            const value = part
                .slice(index + 1)
                .trim();

            if (name) {
                cookies[name] = value;
            }
        });

    return cookies;
}


/*
|--------------------------------------------------------------------------
| BASE64URL
|--------------------------------------------------------------------------
*/

function base64UrlEncode(bytes) {
    let binary = "";

    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}


function base64UrlDecode(value) {
    let base64 = value
        .replace(/-/g, "+")
        .replace(/_/g, "/");

    while (base64.length % 4) {
        base64 += "=";
    }

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}


/*
|--------------------------------------------------------------------------
| CONSTANT TIME
|--------------------------------------------------------------------------
*/

function constantTimeEqual(a, b) {
    const encoder = new TextEncoder();

    const bytesA = encoder.encode(a);
    const bytesB = encoder.encode(b);

    if (bytesA.length !== bytesB.length) {
        return false;
    }

    let result = 0;

    for (let i = 0; i < bytesA.length; i++) {
        result |= bytesA[i] ^ bytesB[i];
    }

    return result === 0;
}


/*
|--------------------------------------------------------------------------
| JSON RESPONSE
|--------------------------------------------------------------------------
*/

function jsonResponse(
    data,
    status = 200,
    extraHeaders = {}
) {
    const headers = new Headers({
        "Content-Type": "application/json; charset=UTF-8",
        "Cache-Control": "no-store"
    });

    for (const [key, value] of Object.entries(extraHeaders)) {
        headers.set(key, value);
    }

    return new Response(
        JSON.stringify(data),
        {
            status,
            headers
        }
    );
}
