// functions/api/faq.js

const SESSION_COOKIE = "jaya_admin_session";

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    try {
        /*
        |--------------------------------------------------------------------------
        | GET /api/faq
        |--------------------------------------------------------------------------
        | Public:
        | hanya FAQ aktif
        |
        | Admin:
        | ?all=1 untuk melihat semua FAQ
        |--------------------------------------------------------------------------
        */

        if (
            request.method === "GET" &&
            url.pathname === "/api/faq"
        ) {
            return await getFaqs(request, env);
        }


        /*
        |--------------------------------------------------------------------------
        | POST /api/faq
        |--------------------------------------------------------------------------
        */

        if (
            request.method === "POST" &&
            url.pathname === "/api/faq"
        ) {
            return await createFaq(request, env);
        }


        /*
        |--------------------------------------------------------------------------
        | POST /api/faq/reorder
        |--------------------------------------------------------------------------
        */

        if (
            request.method === "POST" &&
            url.pathname === "/api/faq/reorder"
        ) {
            return await reorderFaqs(
                request,
                env
            );
        }


        /*
        |--------------------------------------------------------------------------
        | FAQ ID
        |--------------------------------------------------------------------------
        */

        const match = url.pathname.match(
            /^\/api\/faq\/(\d+)$/
        );

        if (match) {
            const faqId = Number(match[1]);

            if (
                !Number.isInteger(faqId) ||
                faqId <= 0
            ) {
                return jsonResponse(
                    {
                        success: false,
                        message: "ID FAQ tidak valid."
                    },
                    400
                );
            }

            if (request.method === "GET") {
                return await getSingleFaq(
                    env,
                    faqId
                );
            }

            if (request.method === "PUT") {
                return await updateFaq(
                    request,
                    env,
                    faqId
                );
            }

            if (request.method === "DELETE") {
                return await deleteFaq(
                    request,
                    env,
                    faqId
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
        console.error("FAQ API ERROR:", error);

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
| GET FAQ
|--------------------------------------------------------------------------
*/

async function getFaqs(request, env) {
    const url = new URL(request.url);

    const includeAll =
        url.searchParams.get("all") === "1";

    /*
     * ?all=1 hanya untuk admin.
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

    const category =
        cleanString(
            url.searchParams.get("category")
        );

    const conditions = [];
    const values = [];

    if (!includeAll) {
        conditions.push(
            "is_active = 1"
        );
    }

    if (category) {
        conditions.push(
            "category = ?"
        );

        values.push(category);
    }

    let query = `
        SELECT
            id,
            question,
            answer,
            category,
            sort_order,
            is_active,
            created_at,
            updated_at
        FROM faqs
    `;

    if (conditions.length > 0) {
        query += `
            WHERE ${conditions.join(" AND ")}
        `;
    }

    query += `
        ORDER BY
            sort_order ASC,
            id ASC
    `;

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
| GET SINGLE FAQ
|--------------------------------------------------------------------------
*/

async function getSingleFaq(
    env,
    faqId
) {
    const faq = await env.DB
        .prepare(`
            SELECT
                id,
                question,
                answer,
                category,
                sort_order,
                is_active,
                created_at,
                updated_at
            FROM faqs
            WHERE id = ?
            LIMIT 1
        `)
        .bind(faqId)
        .first();

    if (!faq) {
        return jsonResponse(
            {
                success: false,
                message: "FAQ tidak ditemukan."
            },
            404
        );
    }

    return jsonResponse({
        success: true,
        data: faq
    });
}


/*
|--------------------------------------------------------------------------
| CREATE FAQ
|--------------------------------------------------------------------------
*/

async function createFaq(
    request,
    env
) {
    const auth = await requireAdmin(
        request,
        env
    );

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

    const question =
        cleanString(body.question);

    const answer =
        cleanString(body.answer);

    if (!question) {
        return jsonResponse(
            {
                success: false,
                message: "Pertanyaan wajib diisi."
            },
            400
        );
    }

    if (!answer) {
        return jsonResponse(
            {
                success: false,
                message: "Jawaban wajib diisi."
            },
            400
        );
    }

    const category =
        cleanString(body.category);

    const sortOrder =
        normalizeInteger(
            body.sort_order
        ) ?? 0;

    const isActive =
        body.is_active === undefined
            ? 1
            : normalizeBoolean(
                body.is_active
            );

    const result = await env.DB
        .prepare(`
            INSERT INTO faqs (
                question,
                answer,
                category,
                sort_order,
                is_active
            )
            VALUES (?, ?, ?, ?, ?)
        `)
        .bind(
            question,
            answer,
            category,
            sortOrder,
            isActive
        )
        .run();

    const faqId =
        result.meta.last_row_id;

    const faq =
        await getFaqObject(
            env,
            faqId
        );

    return jsonResponse(
        {
            success: true,
            message: "FAQ berhasil ditambahkan.",
            data: faq
        },
        201
    );
}


/*
|--------------------------------------------------------------------------
| UPDATE FAQ
|--------------------------------------------------------------------------
*/

async function updateFaq(
    request,
    env,
    faqId
) {
    const auth = await requireAdmin(
        request,
        env
    );

    if (!auth.authenticated) {
        return auth.response;
    }

    const existing = await env.DB
        .prepare(`
            SELECT id
            FROM faqs
            WHERE id = ?
            LIMIT 1
        `)
        .bind(faqId)
        .first();

    if (!existing) {
        return jsonResponse(
            {
                success: false,
                message: "FAQ tidak ditemukan."
            },
            404
        );
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
        "question",
        "answer",
        "category",
        "sort_order",
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

        if (
            field === "question" ||
            field === "answer" ||
            field === "category"
        ) {
            value = cleanString(value);
        }

        if (
            field === "question" &&
            !value
        ) {
            return jsonResponse(
                {
                    success: false,
                    message: "Pertanyaan tidak boleh kosong."
                },
                400
            );
        }

        if (
            field === "answer" &&
            !value
        ) {
            return jsonResponse(
                {
                    success: false,
                    message: "Jawaban tidak boleh kosong."
                },
                400
            );
        }

        if (
            field === "sort_order"
        ) {
            value =
                normalizeInteger(value) ?? 0;
        }

        if (
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

    values.push(faqId);

    await env.DB
        .prepare(`
            UPDATE faqs
            SET ${updates.join(", ")}
            WHERE id = ?
        `)
        .bind(...values)
        .run();

    const faq =
        await getFaqObject(
            env,
            faqId
        );

    return jsonResponse({
        success: true,
        message: "FAQ berhasil diperbarui.",
        data: faq
    });
}


/*
|--------------------------------------------------------------------------
| DELETE FAQ
|--------------------------------------------------------------------------
*/

async function deleteFaq(
    request,
    env,
    faqId
) {
    const auth = await requireAdmin(
        request,
        env
    );

    if (!auth.authenticated) {
        return auth.response;
    }

    const result = await env.DB
        .prepare(`
            DELETE FROM faqs
            WHERE id = ?
        `)
        .bind(faqId)
        .run();

    if (!result.meta.changes) {
        return jsonResponse(
            {
                success: false,
                message: "FAQ tidak ditemukan."
            },
            404
        );
    }

    return jsonResponse({
        success: true,
        message: "FAQ berhasil dihapus."
    });
}


/*
|--------------------------------------------------------------------------
| REORDER FAQ
|--------------------------------------------------------------------------
|
| Body:
|
| {
|   "items": [
|      { "id": 1, "sort_order": 0 },
|      { "id": 3, "sort_order": 1 },
|      { "id": 2, "sort_order": 2 }
|   ]
| }
|
|--------------------------------------------------------------------------
*/

async function reorderFaqs(
    request,
    env
) {
    const auth = await requireAdmin(
        request,
        env
    );

    if (!auth.authenticated) {
        return auth.response;
    }

    const body = await readJson(request);

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

    for (const item of body.items) {
        const faqId =
            normalizeInteger(
                item.id
            );

        const sortOrder =
            normalizeInteger(
                item.sort_order
            );

        if (
            faqId === null ||
            faqId <= 0 ||
            sortOrder === null
        ) {
            continue;
        }

        await env.DB
            .prepare(`
                UPDATE faqs
                SET
                    sort_order = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `)
            .bind(
                sortOrder,
                faqId
            )
            .run();
    }

    return jsonResponse({
        success: true,
        message: "Urutan FAQ berhasil diperbarui."
    });
}


/*
|--------------------------------------------------------------------------
| GET FAQ OBJECT
|--------------------------------------------------------------------------
*/

async function getFaqObject(
    env,
    faqId
) {
    return await env.DB
        .prepare(`
            SELECT
                id,
                question,
                answer,
                category,
                sort_order,
                is_active,
                created_at,
                updated_at
            FROM faqs
            WHERE id = ?
            LIMIT 1
        `)
        .bind(faqId)
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
