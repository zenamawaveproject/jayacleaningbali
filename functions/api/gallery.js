// functions/api/gallery.js

const SESSION_COOKIE = "jaya_admin_session";

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    try {
        /*
        |--------------------------------------------------------------------------
        | GET /api/gallery
        |--------------------------------------------------------------------------
        | Public:
        | hanya gallery aktif
        |
        | Admin:
        | ?all=1 untuk melihat seluruh gallery
        |--------------------------------------------------------------------------
        */

        if (
            request.method === "GET" &&
            url.pathname === "/api/gallery"
        ) {
            return await getGallery(request, env);
        }


        /*
        |--------------------------------------------------------------------------
        | POST /api/gallery
        |--------------------------------------------------------------------------
        */

        if (
            request.method === "POST" &&
            url.pathname === "/api/gallery"
        ) {
            return await createGallery(request, env);
        }


        /*
        |--------------------------------------------------------------------------
        | Gallery ID
        |--------------------------------------------------------------------------
        */

        const match = url.pathname.match(
            /^\/api\/gallery\/(\d+)$/
        );

        if (match) {
            const galleryId = Number(match[1]);

            if (
                !Number.isInteger(galleryId) ||
                galleryId <= 0
            ) {
                return jsonResponse(
                    {
                        success: false,
                        message: "ID gallery tidak valid."
                    },
                    400
                );
            }

            if (request.method === "GET") {
                return await getSingleGallery(
                    env,
                    galleryId
                );
            }

            if (request.method === "PUT") {
                return await updateGallery(
                    request,
                    env,
                    galleryId
                );
            }

            if (request.method === "DELETE") {
                return await deleteGallery(
                    request,
                    env,
                    galleryId
                );
            }
        }


        /*
        |--------------------------------------------------------------------------
        | POST /api/gallery/reorder
        |--------------------------------------------------------------------------
        */

        if (
            request.method === "POST" &&
            url.pathname === "/api/gallery/reorder"
        ) {
            return await reorderGallery(
                request,
                env
            );
        }


        return jsonResponse(
            {
                success: false,
                message: "Endpoint tidak ditemukan."
            },
            404
        );

    } catch (error) {
        console.error("GALLERY API ERROR:", error);

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
| GET GALLERY
|--------------------------------------------------------------------------
*/

async function getGallery(request, env) {
    const url = new URL(request.url);

    const includeAll =
        url.searchParams.get("all") === "1";

    /*
     * all=1 hanya untuk admin.
     */

    if (includeAll) {
        const auth = await requireAdmin(
            request,
            env
        );

        if (!auth.authenticated) {
            return auth.response;
        }
    }

    const serviceIdParam =
        url.searchParams.get("service_id");

    const category =
        cleanString(
            url.searchParams.get("category")
        );

    const featured =
        url.searchParams.get("featured");

    const limitParam =
        Number(
            url.searchParams.get("limit")
        );

    const limit =
        Number.isInteger(limitParam) &&
        limitParam > 0 &&
        limitParam <= 100
            ? limitParam
            : 100;

    const conditions = [];
    const values = [];

    if (!includeAll) {
        conditions.push(
            "g.is_active = 1"
        );
    }

    if (
        serviceIdParam !== null &&
        serviceIdParam !== ""
    ) {
        const serviceId =
            Number(serviceIdParam);

        if (
            Number.isInteger(serviceId) &&
            serviceId > 0
        ) {
            conditions.push(
                "g.service_id = ?"
            );

            values.push(serviceId);
        }
    }

    if (category) {
        conditions.push(
            "g.category = ?"
        );

        values.push(category);
    }

    if (
        featured === "1" ||
        featured === "0"
    ) {
        conditions.push(
            "g.is_featured = ?"
        );

        values.push(
            Number(featured)
        );
    }

    let query = `
        SELECT
            g.id,
            g.title,
            g.description,
            g.image_media_id,
            g.category,
            g.location,
            g.service_id,
            g.sort_order,
            g.is_featured,
            g.is_active,
            g.created_at,
            g.updated_at,

            m.file_name,
            m.original_name,
            m.r2_key,
            m.url AS image_url,
            m.mime_type,
            m.file_size,
            m.width,
            m.height,
            m.alt_text,
            m.caption,

            s.name AS service_name,
            s.slug AS service_slug

        FROM gallery g

        INNER JOIN media m
            ON m.id = g.image_media_id

        LEFT JOIN services s
            ON s.id = g.service_id
    `;

    if (conditions.length > 0) {
        query += `
            WHERE ${conditions.join(" AND ")}
        `;
    }

    query += `
        ORDER BY
            g.sort_order ASC,
            g.id DESC
        LIMIT ?
    `;

    values.push(limit);

    const result = await env.DB
        .prepare(query)
        .bind(...values)
        .all();

    return jsonResponse({
        success: true,
        data: result.results || []
    });
}


/*
|--------------------------------------------------------------------------
| GET SINGLE GALLERY
|--------------------------------------------------------------------------
*/

async function getSingleGallery(
    env,
    galleryId
) {
    const gallery =
        await getGalleryObject(
            env,
            galleryId
        );

    if (!gallery) {
        return jsonResponse(
            {
                success: false,
                message: "Gallery tidak ditemukan."
            },
            404
        );
    }

    return jsonResponse({
        success: true,
        data: gallery
    });
}


/*
|--------------------------------------------------------------------------
| CREATE GALLERY
|--------------------------------------------------------------------------
*/

async function createGallery(
    request,
    env
) {
    const auth =
        await requireAdmin(
            request,
            env
        );

    if (!auth.authenticated) {
        return auth.response;
    }

    const body =
        await readJson(request);

    if (!body) {
        return jsonResponse(
            {
                success: false,
                message: "Data JSON tidak valid."
            },
            400
        );
    }

    const imageMediaId =
        normalizeInteger(
            body.image_media_id
        );

    if (
        imageMediaId === null ||
        imageMediaId <= 0
    ) {
        return jsonResponse(
            {
                success: false,
                message: "Gambar gallery wajib dipilih."
            },
            400
        );
    }

    /*
     * Pastikan media benar-benar ada.
     */

    const media =
        await env.DB
            .prepare(`
                SELECT id
                FROM media
                WHERE id = ?
                LIMIT 1
            `)
            .bind(imageMediaId)
            .first();

    if (!media) {
        return jsonResponse(
            {
                success: false,
                message: "Media gambar tidak ditemukan."
            },
            400
        );
    }

    /*
     * Jika service_id diberikan,
     * pastikan service ada.
     */

    let serviceId =
        normalizeInteger(
            body.service_id
        );

    if (
        serviceId !== null &&
        serviceId > 0
    ) {
        const service =
            await env.DB
                .prepare(`
                    SELECT id
                    FROM services
                    WHERE id = ?
                    LIMIT 1
                `)
                .bind(serviceId)
                .first();

        if (!service) {
            return jsonResponse(
                {
                    success: false,
                    message: "Layanan tidak ditemukan."
                },
                400
            );
        }
    } else {
        serviceId = null;
    }

    const title =
        cleanString(body.title);

    const description =
        cleanString(body.description);

    const category =
        cleanString(body.category);

    const location =
        cleanString(body.location);

    const sortOrder =
        normalizeInteger(
            body.sort_order
        ) ?? 0;

    const isFeatured =
        normalizeBoolean(
            body.is_featured
        );

    const isActive =
        body.is_active === undefined
            ? 1
            : normalizeBoolean(
                body.is_active
            );

    const result =
        await env.DB
            .prepare(`
                INSERT INTO gallery (
                    title,
                    description,
                    image_media_id,
                    category,
                    location,
                    service_id,
                    sort_order,
                    is_featured,
                    is_active
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .bind(
                title,
                description,
                imageMediaId,
                category,
                location,
                serviceId,
                sortOrder,
                isFeatured,
                isActive
            )
            .run();

    const galleryId =
        result.meta.last_row_id;

    const gallery =
        await getGalleryObject(
            env,
            galleryId
        );

    return jsonResponse(
        {
            success: true,
            message: "Gallery berhasil ditambahkan.",
            data: gallery
        },
        201
    );
}


/*
|--------------------------------------------------------------------------
| UPDATE GALLERY
|--------------------------------------------------------------------------
*/

async function updateGallery(
    request,
    env,
    galleryId
) {
    const auth =
        await requireAdmin(
            request,
            env
        );

    if (!auth.authenticated) {
        return auth.response;
    }

    const existing =
        await env.DB
            .prepare(`
                SELECT *
                FROM gallery
                WHERE id = ?
                LIMIT 1
            `)
            .bind(galleryId)
            .first();

    if (!existing) {
        return jsonResponse(
            {
                success: false,
                message: "Gallery tidak ditemukan."
            },
            404
        );
    }

    const body =
        await readJson(request);

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
        "title",
        "description",
        "image_media_id",
        "category",
        "location",
        "service_id",
        "sort_order",
        "is_featured",
        "is_active"
    ];

    const updates = [];
    const values = [];

    for (const field of allowedFields) {
        if (
            !Object.prototype.hasOwnProperty.call(
                body,
                field
            )
        ) {
            continue;
        }

        let value = body[field];

        /*
         * String fields.
         */

        if (
            field === "title" ||
            field === "description" ||
            field === "category" ||
            field === "location"
        ) {
            value = cleanString(value);
        }

        /*
         * Media.
         */

        if (
            field === "image_media_id"
        ) {
            value =
                normalizeInteger(value);

            if (
                value === null ||
                value <= 0
            ) {
                return jsonResponse(
                    {
                        success: false,
                        message: "Media gambar tidak valid."
                    },
                    400
                );
            }

            const media =
                await env.DB
                    .prepare(`
                        SELECT id
                        FROM media
                        WHERE id = ?
                        LIMIT 1
                    `)
                    .bind(value)
                    .first();

            if (!media) {
                return jsonResponse(
                    {
                        success: false,
                        message: "Media gambar tidak ditemukan."
                    },
                    400
                );
            }
        }

        /*
         * Service.
         */

        if (
            field === "service_id"
        ) {
            value =
                normalizeInteger(value);

            /*
             * NULL berarti gallery
             * tidak dikaitkan ke service.
             */

            if (
                value !== null &&
                value > 0
            ) {
                const service =
                    await env.DB
                        .prepare(`
                            SELECT id
                            FROM services
                            WHERE id = ?
                            LIMIT 1
                        `)
                        .bind(value)
                        .first();

                if (!service) {
                    return jsonResponse(
                        {
                            success: false,
                            message: "Layanan tidak ditemukan."
                        },
                        400
                    );
                }
            } else {
                value = null;
            }
        }

        /*
         * Integer.
         */

        if (
            field === "sort_order"
        ) {
            value =
                normalizeInteger(value) ?? 0;
        }

        /*
         * Boolean.
         */

        if (
            field === "is_featured" ||
            field === "is_active"
        ) {
            value =
                normalizeBoolean(value);
        }

        updates.push(
            `${field} = ?`
        );

        values.push(value);
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

    updates.push(
        "updated_at = CURRENT_TIMESTAMP"
    );

    values.push(galleryId);

    await env.DB
        .prepare(`
            UPDATE gallery
            SET ${updates.join(", ")}
            WHERE id = ?
        `)
        .bind(...values)
        .run();

    const gallery =
        await getGalleryObject(
            env,
            galleryId
        );

    return jsonResponse({
        success: true,
        message: "Gallery berhasil diperbarui.",
        data: gallery
    });
}


/*
|--------------------------------------------------------------------------
| DELETE GALLERY
|--------------------------------------------------------------------------
|
| Yang dihapus hanya record gallery.
|
| File media TIDAK dihapus dari R2.
| Media bisa saja masih dipakai oleh tempat lain.
|--------------------------------------------------------------------------
*/

async function deleteGallery(
    request,
    env,
    galleryId
) {
    const auth =
        await requireAdmin(
            request,
            env
        );

    if (!auth.authenticated) {
        return auth.response;
    }

    const existing =
        await env.DB
            .prepare(`
                SELECT id
                FROM gallery
                WHERE id = ?
                LIMIT 1
            `)
            .bind(galleryId)
            .first();

    if (!existing) {
        return jsonResponse(
            {
                success: false,
                message: "Gallery tidak ditemukan."
            },
            404
        );
    }

    await env.DB
        .prepare(`
            DELETE FROM gallery
            WHERE id = ?
        `)
        .bind(galleryId)
        .run();

    return jsonResponse({
        success: true,
        message: "Gallery berhasil dihapus."
    });
}


/*
|--------------------------------------------------------------------------
| REORDER GALLERY
|--------------------------------------------------------------------------
|
| Body:
|
| {
|   "items": [
|      { "id": 1, "sort_order": 0 },
|      { "id": 4, "sort_order": 1 }
|   ]
| }
|--------------------------------------------------------------------------
*/

async function reorderGallery(
    request,
    env
) {
    const auth =
        await requireAdmin(
            request,
            env
        );

    if (!auth.authenticated) {
        return auth.response;
    }

    const body =
        await readJson(request);

    if (
        !body ||
        !Array.isArray(body.items)
    ) {
        return jsonResponse(
            {
                success: false,
                message: "Format items tidak valid."
            },
            400
        );
    }

    if (body.items.length > 100) {
        return jsonResponse(
            {
                success: false,
                message: "Jumlah item terlalu banyak."
            },
            400
        );
    }

    for (
        const item of body.items
    ) {
        const galleryId =
            normalizeInteger(
                item.id
            );

        const sortOrder =
            normalizeInteger(
                item.sort_order
            );

        if (
            galleryId === null ||
            galleryId <= 0 ||
            sortOrder === null
        ) {
            continue;
        }

        await env.DB
            .prepare(`
                UPDATE gallery
                SET
                    sort_order = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `)
            .bind(
                sortOrder,
                galleryId
            )
            .run();
    }

    return jsonResponse({
        success: true,
        message: "Urutan gallery berhasil diperbarui."
    });
}


/*
|--------------------------------------------------------------------------
| GET GALLERY OBJECT
|--------------------------------------------------------------------------
*/

async function getGalleryObject(
    env,
    galleryId
) {
    return await env.DB
        .prepare(`
            SELECT
                g.id,
                g.title,
                g.description,
                g.image_media_id,
                g.category,
                g.location,
                g.service_id,
                g.sort_order,
                g.is_featured,
                g.is_active,
                g.created_at,
                g.updated_at,

                m.file_name,
                m.original_name,
                m.r2_key,
                m.url AS image_url,
                m.mime_type,
                m.file_size,
                m.width,
                m.height,
                m.alt_text,
                m.caption,

                s.name AS service_name,
                s.slug AS service_slug

            FROM gallery g

            INNER JOIN media m
                ON m.id = g.image_media_id

            LEFT JOIN services s
                ON s.id = g.service_id

            WHERE g.id = ?

            LIMIT 1
        `)
        .bind(galleryId)
        .first();
}


/*
|--------------------------------------------------------------------------
| ADMIN AUTH
|--------------------------------------------------------------------------
*/

async function requireAdmin(
    request,
    env
) {
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

    const cookies =
        parseCookies(
            request.headers.get("Cookie") || ""
        );

    const token =
        cookies[SESSION_COOKIE];

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

    const session =
        await verifySessionToken(
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

    const admin =
        await env.DB
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

    if (
        !admin ||
        Number(admin.is_active) !== 1
    ) {
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
| VERIFY SESSION
|--------------------------------------------------------------------------
*/

async function verifySessionToken(
    token,
    secret
) {
    try {
        const parts =
            token.split(".");

        if (parts.length !== 2) {
            return null;
        }

        const encodedPayload =
            parts[0];

        const signature =
            parts[1];

        const expectedSignature =
            await signHmac(
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

        const payloadBytes =
            base64UrlDecode(
                encodedPayload
            );

        const payload =
            JSON.parse(
                new TextDecoder().decode(
                    payloadBytes
                )
            );

        const now =
            Math.floor(
                Date.now() / 1000
            );

        if (
            !payload.exp ||
            now >= payload.exp
        ) {
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

async function signHmac(
    message,
    secret
) {
    const encoder =
        new TextEncoder();

    const key =
        await crypto.subtle.importKey(
            "raw",
            encoder.encode(secret),
            {
                name: "HMAC",
                hash: "SHA-256"
            },
            false,
            ["sign"]
        );

    const signature =
        await crypto.subtle.sign(
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
| JSON
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
| STRING
|--------------------------------------------------------------------------
*/

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
| INTEGER
|--------------------------------------------------------------------------
*/

function normalizeInteger(value) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return null;
    }

    const number =
        Number(value);

    if (!Number.isInteger(number)) {
        return null;
    }

    return number;
}


/*
|--------------------------------------------------------------------------
| BOOLEAN
|--------------------------------------------------------------------------
*/

function normalizeBoolean(value) {
    return (
        value === true ||
        value === 1 ||
        value === "1" ||
        value === "true"
    )
        ? 1
        : 0;
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
            const index =
                part.indexOf("=");

            if (index === -1) {
                return;
            }

            const name =
                part
                    .slice(0, index)
                    .trim();

            const value =
                part
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

    for (
        const byte of bytes
    ) {
        binary += String.fromCharCode(
            byte
        );
    }

    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}


function base64UrlDecode(value) {
    let base64 =
        value
            .replace(/-/g, "+")
            .replace(/_/g, "/");

    while (
        base64.length % 4
    ) {
        base64 += "=";
    }

    const binary =
        atob(base64);

    const bytes =
        new Uint8Array(
            binary.length
        );

    for (
        let i = 0;
        i < binary.length;
        i++
    ) {
        bytes[i] =
            binary.charCodeAt(i);
    }

    return bytes;
}


/*
|--------------------------------------------------------------------------
| CONSTANT TIME
|--------------------------------------------------------------------------
*/

function constantTimeEqual(a, b) {
    const encoder =
        new TextEncoder();

    const bytesA =
        encoder.encode(a);

    const bytesB =
        encoder.encode(b);

    if (
        bytesA.length !==
        bytesB.length
    ) {
        return false;
    }

    let result = 0;

    for (
        let i = 0;
        i < bytesA.length;
        i++
    ) {
        result |=
            bytesA[i] ^
            bytesB[i];
    }

    return result === 0;
}


/*
|--------------------------------------------------------------------------
| RESPONSE
|--------------------------------------------------------------------------
*/

function jsonResponse(
    data,
    status = 200,
    extraHeaders = {}
) {
    const headers =
        new Headers({
            "Content-Type":
                "application/json; charset=UTF-8",
            "Cache-Control":
                "no-store"
        });

    for (
        const [key, value]
        of Object.entries(
            extraHeaders
        )
    ) {
        headers.set(
            key,
            value
        );
    }

    return new Response(
        JSON.stringify(data),
        {
            status,
            headers
        }
    );
}
