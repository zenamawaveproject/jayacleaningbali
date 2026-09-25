// functions/api/services.js

const SESSION_COOKIE = "jaya_admin_session";

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    try {
        /*
        |--------------------------------------------------------------------------
        | GET /api/services
        |--------------------------------------------------------------------------
        | Public: mengambil semua layanan aktif.
        |
        | Query:
        | ?all=1
        | hanya boleh digunakan admin
        |--------------------------------------------------------------------------
        */

        if (
            request.method === "GET" &&
            url.pathname === "/api/services"
        ) {
            return await getServices(request, env);
        }


        /*
        |--------------------------------------------------------------------------
        | POST /api/services
        |--------------------------------------------------------------------------
        */

        if (
            request.method === "POST" &&
            url.pathname === "/api/services"
        ) {
            return await createService(request, env);
        }


        /*
        |--------------------------------------------------------------------------
        | Service ID routes
        |--------------------------------------------------------------------------
        */

        const serviceMatch = url.pathname.match(
            /^\/api\/services\/(\d+)$/
        );

        if (serviceMatch) {
            const serviceId = Number(serviceMatch[1]);

            if (
                !Number.isInteger(serviceId) ||
                serviceId <= 0
            ) {
                return jsonResponse(
                    {
                        success: false,
                        message: "ID layanan tidak valid."
                    },
                    400
                );
            }

            if (request.method === "GET") {
                return await getService(
                    env,
                    serviceId
                );
            }

            if (request.method === "PUT") {
                return await updateService(
                    request,
                    env,
                    serviceId
                );
            }

            if (request.method === "DELETE") {
                return await deleteService(
                    request,
                    env,
                    serviceId
                );
            }
        }


        /*
        |--------------------------------------------------------------------------
        | POST /api/services/:id/prices
        |--------------------------------------------------------------------------
        */

        const pricesMatch = url.pathname.match(
            /^\/api\/services\/(\d+)\/prices$/
        );

        if (pricesMatch) {
            const serviceId = Number(pricesMatch[1]);

            if (
                !Number.isInteger(serviceId) ||
                serviceId <= 0
            ) {
                return jsonResponse(
                    {
                        success: false,
                        message: "ID layanan tidak valid."
                    },
                    400
                );
            }

            if (request.method === "POST") {
                return await createPrice(
                    request,
                    env,
                    serviceId
                );
            }
        }


        /*
        |--------------------------------------------------------------------------
        | Price ID routes
        |--------------------------------------------------------------------------
        */

        const priceMatch = url.pathname.match(
            /^\/api\/services\/(\d+)\/prices\/(\d+)$/
        );

        if (priceMatch) {
            const serviceId = Number(priceMatch[1]);
            const priceId = Number(priceMatch[2]);

            if (
                !Number.isInteger(serviceId) ||
                serviceId <= 0 ||
                !Number.isInteger(priceId) ||
                priceId <= 0
            ) {
                return jsonResponse(
                    {
                        success: false,
                        message: "ID layanan atau harga tidak valid."
                    },
                    400
                );
            }

            if (request.method === "PUT") {
                return await updatePrice(
                    request,
                    env,
                    serviceId,
                    priceId
                );
            }

            if (request.method === "DELETE") {
                return await deletePrice(
                    request,
                    env,
                    serviceId,
                    priceId
                );
            }
        }


        /*
        |--------------------------------------------------------------------------
        | POST /api/services/:id/prices/reorder
        |--------------------------------------------------------------------------
        */

        const reorderMatch = url.pathname.match(
            /^\/api\/services\/(\d+)\/prices\/reorder$/
        );

        if (reorderMatch) {
            const serviceId = Number(reorderMatch[1]);

            if (
                !Number.isInteger(serviceId) ||
                serviceId <= 0
            ) {
                return jsonResponse(
                    {
                        success: false,
                        message: "ID layanan tidak valid."
                    },
                    400
                );
            }

            if (request.method === "POST") {
                return await reorderPrices(
                    request,
                    env,
                    serviceId
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
        console.error("SERVICES API ERROR:", error);

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
| GET SERVICES
|--------------------------------------------------------------------------
*/

async function getServices(request, env) {
    const url = new URL(request.url);

    const includeAll =
        url.searchParams.get("all") === "1";

    /*
     * ?all=1 membutuhkan login admin.
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

    let query = `
        SELECT
            s.id,
            s.slug,
            s.name,
            s.short_description,
            s.description,
            s.price_label,
            s.price,
            s.price_unit,
            s.image_media_id,
            s.accent_style,
            s.badge,
            s.duration,
            s.sort_order,
            s.is_featured,
            s.is_active,
            s.meta_title,
            s.meta_description,
            s.created_at,
            s.updated_at,

            m.r2_key AS image_r2_key,
            m.url AS image_url,
            m.alt_text AS image_alt_text

        FROM services s

        LEFT JOIN media m
            ON m.id = s.image_media_id
    `;

    if (!includeAll) {
        query += `
            WHERE s.is_active = 1
        `;
    }

    query += `
        ORDER BY
            s.sort_order ASC,
            s.id ASC
    `;

    const services = await env.DB
        .prepare(query)
        .all();

    const results = services.results || [];

    /*
     * Ambil price variants untuk semua service.
     */

    if (results.length > 0) {
        const serviceIds = results.map(
            service => service.id
        );

        const placeholders = serviceIds
            .map(() => "?")
            .join(",");

        const prices = await env.DB
            .prepare(`
                SELECT
                    id,
                    service_id,
                    variant_name,
                    description,
                    price,
                    price_label,
                    unit,
                    sort_order,
                    is_active,
                    created_at,
                    updated_at
                FROM service_prices
                WHERE service_id IN (${placeholders})
                ${includeAll ? "" : "AND is_active = 1"}
                ORDER BY
                    sort_order ASC,
                    id ASC
            `)
            .bind(...serviceIds)
            .all();

        const priceResults =
            prices.results || [];

        for (const service of results) {
            service.prices =
                priceResults.filter(
                    price =>
                        Number(price.service_id) ===
                        Number(service.id)
                );
        }
    }

    return jsonResponse({
        success: true,
        data: results
    });
}


/*
|--------------------------------------------------------------------------
| GET SINGLE SERVICE
|--------------------------------------------------------------------------
*/

async function getService(env, serviceId) {
    const service = await env.DB
        .prepare(`
            SELECT
                s.*,

                m.r2_key AS image_r2_key,
                m.url AS image_url,
                m.alt_text AS image_alt_text

            FROM services s

            LEFT JOIN media m
                ON m.id = s.image_media_id

            WHERE s.id = ?

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
            404
        );
    }

    const prices = await env.DB
        .prepare(`
            SELECT
                id,
                service_id,
                variant_name,
                description,
                price,
                price_label,
                unit,
                sort_order,
                is_active,
                created_at,
                updated_at
            FROM service_prices
            WHERE service_id = ?
            ORDER BY
                sort_order ASC,
                id ASC
        `)
        .bind(serviceId)
        .all();

    service.prices =
        prices.results || [];

    return jsonResponse({
        success: true,
        data: service
    });
}


/*
|--------------------------------------------------------------------------
| CREATE SERVICE
|--------------------------------------------------------------------------
*/

async function createService(request, env) {
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

    const name = cleanString(body.name);

    if (!name) {
        return jsonResponse(
            {
                success: false,
                message: "Nama layanan wajib diisi."
            },
            400
        );
    }

    let slug = cleanString(body.slug);

    if (!slug) {
        slug = slugify(name);
    } else {
        slug = slugify(slug);
    }

    if (!slug) {
        return jsonResponse(
            {
                success: false,
                message: "Slug layanan tidak valid."
            },
            400
        );
    }

    const existing = await env.DB
        .prepare(`
            SELECT id
            FROM services
            WHERE slug = ?
            LIMIT 1
        `)
        .bind(slug)
        .first();

    if (existing) {
        return jsonResponse(
            {
                success: false,
                message: "Slug layanan sudah digunakan."
            },
            409
        );
    }

    const imageMediaId =
        normalizeInteger(
            body.image_media_id
        );

    const price =
        normalizeInteger(body.price);

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

    const result = await env.DB
        .prepare(`
            INSERT INTO services (
                slug,
                name,
                short_description,
                description,
                price_label,
                price,
                price_unit,
                image_media_id,
                accent_style,
                badge,
                duration,
                sort_order,
                is_featured,
                is_active,
                meta_title,
                meta_description
            )
            VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
        `)
        .bind(
            slug,
            name,
            cleanString(body.short_description),
            cleanString(body.description),
            cleanString(body.price_label),
            price,
            cleanString(body.price_unit),
            imageMediaId,
            cleanString(body.accent_style) || "default",
            cleanString(body.badge),
            cleanString(body.duration),
            sortOrder,
            isFeatured,
            isActive,
            cleanString(body.meta_title),
            cleanString(body.meta_description)
        )
        .run();

    const serviceId =
        result.meta.last_row_id;

    const service = await getServiceObject(
        env,
        serviceId
    );

    return jsonResponse(
        {
            success: true,
            message: "Layanan berhasil dibuat.",
            data: service
        },
        201
    );
}


/*
|--------------------------------------------------------------------------
| UPDATE SERVICE
|--------------------------------------------------------------------------
*/

async function updateService(
    request,
    env,
    serviceId
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

    const existing = await env.DB
        .prepare(`
            SELECT *
            FROM services
            WHERE id = ?
            LIMIT 1
        `)
        .bind(serviceId)
        .first();

    if (!existing) {
        return jsonResponse(
            {
                success: false,
                message: "Layanan tidak ditemukan."
            },
            404
        );
    }

    const allowedFields = [
        "slug",
        "name",
        "short_description",
        "description",
        "price_label",
        "price",
        "price_unit",
        "image_media_id",
        "accent_style",
        "badge",
        "duration",
        "sort_order",
        "is_featured",
        "is_active",
        "meta_title",
        "meta_description"
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
            field === "slug" ||
            field === "name" ||
            field === "short_description" ||
            field === "description" ||
            field === "price_label" ||
            field === "price_unit" ||
            field === "accent_style" ||
            field === "badge" ||
            field === "duration" ||
            field === "meta_title" ||
            field === "meta_description"
        ) {
            value = cleanString(value);
        }

        if (field === "slug") {
            value = slugify(value);

            if (!value) {
                return jsonResponse(
                    {
                        success: false,
                        message: "Slug tidak valid."
                    },
                    400
                );
            }

            const duplicate = await env.DB
                .prepare(`
                    SELECT id
                    FROM services
                    WHERE slug = ?
                    AND id != ?
                    LIMIT 1
                `)
                .bind(
                    value,
                    serviceId
                )
                .first();

            if (duplicate) {
                return jsonResponse(
                    {
                        success: false,
                        message: "Slug layanan sudah digunakan."
                    },
                    409
                );
            }
        }

        if (
            field === "price" ||
            field === "image_media_id" ||
            field === "sort_order"
        ) {
            value =
                normalizeInteger(value);
        }

        if (
            field === "is_featured" ||
            field === "is_active"
        ) {
            value =
                normalizeBoolean(value);
        }

        updates.push(`${field} = ?`);
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

    values.push(serviceId);

    await env.DB
        .prepare(`
            UPDATE services
            SET ${updates.join(", ")}
            WHERE id = ?
        `)
        .bind(...values)
        .run();

    const service = await getServiceObject(
        env,
        serviceId
    );

    return jsonResponse({
        success: true,
        message: "Layanan berhasil diperbarui.",
        data: service
    });
}


/*
|--------------------------------------------------------------------------
| DELETE SERVICE
|--------------------------------------------------------------------------
|
| Menghapus service sekaligus semua price variant
| karena service_prices memiliki ON DELETE CASCADE.
|
| Gallery yang terhubung tidak ikut dihapus.
|--------------------------------------------------------------------------
*/

async function deleteService(
    request,
    env,
    serviceId
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
            FROM services
            WHERE id = ?
            LIMIT 1
        `)
        .bind(serviceId)
        .first();

    if (!existing) {
        return jsonResponse(
            {
                success: false,
                message: "Layanan tidak ditemukan."
            },
            404
        );
    }

    await env.DB
        .prepare(`
            DELETE FROM services
            WHERE id = ?
        `)
        .bind(serviceId)
        .run();

    return jsonResponse({
        success: true,
        message: "Layanan berhasil dihapus."
    });
}


/*
|--------------------------------------------------------------------------
| CREATE PRICE
|--------------------------------------------------------------------------
*/

async function createPrice(
    request,
    env,
    serviceId
) {
    const auth = await requireAdmin(
        request,
        env
    );

    if (!auth.authenticated) {
        return auth.response;
    }

    const service = await env.DB
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

    const variantName =
        cleanString(
            body.variant_name
        );

    if (!variantName) {
        return jsonResponse(
            {
                success: false,
                message: "Nama variasi harga wajib diisi."
            },
            400
        );
    }

    const price =
        normalizeInteger(body.price);

    if (
        price === null ||
        price < 0
    ) {
        return jsonResponse(
            {
                success: false,
                message: "Harga tidak valid."
            },
            400
        );
    }

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
            INSERT INTO service_prices (
                service_id,
                variant_name,
                description,
                price,
                price_label,
                unit,
                sort_order,
                is_active
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
            serviceId,
            variantName,
            cleanString(
                body.description
            ),
            price,
            cleanString(
                body.price_label
            ),
            cleanString(
                body.unit
            ),
            sortOrder,
            isActive
        )
        .run();

    const priceId =
        result.meta.last_row_id;

    const createdPrice =
        await getPriceObject(
            env,
            serviceId,
            priceId
        );

    return jsonResponse(
        {
            success: true,
            message: "Variasi harga berhasil ditambahkan.",
            data: createdPrice
        },
        201
    );
}


/*
|--------------------------------------------------------------------------
| UPDATE PRICE
|--------------------------------------------------------------------------
*/

async function updatePrice(
    request,
    env,
    serviceId,
    priceId
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
            SELECT *
            FROM service_prices
            WHERE id = ?
            AND service_id = ?
            LIMIT 1
        `)
        .bind(
            priceId,
            serviceId
        )
        .first();

    if (!existing) {
        return jsonResponse(
            {
                success: false,
                message: "Variasi harga tidak ditemukan."
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
        "variant_name",
        "description",
        "price",
        "price_label",
        "unit",
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
            field === "variant_name" ||
            field === "description" ||
            field === "price_label" ||
            field === "unit"
        ) {
            value = cleanString(value);
        }

        if (
            field === "price" ||
            field === "sort_order"
        ) {
            value =
                normalizeInteger(value);

            if (
                field === "price" &&
                (value === null || value < 0)
            ) {
                return jsonResponse(
                    {
                        success: false,
                        message: "Harga tidak valid."
                    },
                    400
                );
            }
        }

        if (field === "is_active") {
            value =
                normalizeBoolean(value);
        }

        updates.push(`${field} = ?`);
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

    values.push(priceId);
    values.push(serviceId);

    await env.DB
        .prepare(`
            UPDATE service_prices
            SET ${updates.join(", ")}
            WHERE id = ?
            AND service_id = ?
        `)
        .bind(...values)
        .run();

    const updatedPrice =
        await getPriceObject(
            env,
            serviceId,
            priceId
        );

    return jsonResponse({
        success: true,
        message: "Variasi harga berhasil diperbarui.",
        data: updatedPrice
    });
}


/*
|--------------------------------------------------------------------------
| DELETE PRICE
|--------------------------------------------------------------------------
*/

async function deletePrice(
    request,
    env,
    serviceId,
    priceId
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
            DELETE FROM service_prices
            WHERE id = ?
            AND service_id = ?
        `)
        .bind(
            priceId,
            serviceId
        )
        .run();

    if (!result.meta.changes) {
        return jsonResponse(
            {
                success: false,
                message: "Variasi harga tidak ditemukan."
            },
            404
        );
    }

    return jsonResponse({
        success: true,
        message: "Variasi harga berhasil dihapus."
    });
}


/*
|--------------------------------------------------------------------------
| REORDER PRICES
|--------------------------------------------------------------------------
|
| Body:
|
| {
|   "items": [
|      { "id": 4, "sort_order": 0 },
|      { "id": 2, "sort_order": 1 },
|      { "id": 7, "sort_order": 2 }
|   ]
| }
|
|--------------------------------------------------------------------------
*/

async function reorderPrices(
    request,
    env,
    serviceId
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

    /*
     * Batasi jumlah supaya request tidak terlalu besar.
     */

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
        const priceId =
            normalizeInteger(item.id);

        const sortOrder =
            normalizeInteger(
                item.sort_order
            );

        if (
            !priceId ||
            sortOrder === null
        ) {
            continue;
        }

        await env.DB
            .prepare(`
                UPDATE service_prices
                SET
                    sort_order = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                AND service_id = ?
            `)
            .bind(
                sortOrder,
                priceId,
                serviceId
            )
            .run();
    }

    return jsonResponse({
        success: true,
        message: "Urutan harga berhasil diperbarui."
    });
}


/*
|--------------------------------------------------------------------------
| GET SERVICE OBJECT
|--------------------------------------------------------------------------
*/

async function getServiceObject(
    env,
    serviceId
) {
    const service = await env.DB
        .prepare(`
            SELECT
                s.*,

                m.r2_key AS image_r2_key,
                m.url AS image_url,
                m.alt_text AS image_alt_text

            FROM services s

            LEFT JOIN media m
                ON m.id = s.image_media_id

            WHERE s.id = ?

            LIMIT 1
        `)
        .bind(serviceId)
        .first();

    if (!service) {
        return null;
    }

    const prices = await env.DB
        .prepare(`
            SELECT
                id,
                service_id,
                variant_name,
                description,
                price,
                price_label,
                unit,
                sort_order,
                is_active,
                created_at,
                updated_at
            FROM service_prices
            WHERE service_id = ?
            ORDER BY
                sort_order ASC,
                id ASC
        `)
        .bind(serviceId)
        .all();

    service.prices =
        prices.results || [];

    return service;
}


/*
|--------------------------------------------------------------------------
| GET PRICE OBJECT
|--------------------------------------------------------------------------
*/

async function getPriceObject(
    env,
    serviceId,
    priceId
) {
    return await env.DB
        .prepare(`
            SELECT
                id,
                service_id,
                variant_name,
                description,
                price,
                price_label,
                unit,
                sort_order,
                is_active,
                created_at,
                updated_at
            FROM service_prices
            WHERE id = ?
            AND service_id = ?
            LIMIT 1
        `)
        .bind(
            priceId,
            serviceId
        )
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

    const cookies = parseCookies(
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
| HMAC
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

    const number = Number(value);

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
| SLUG
|--------------------------------------------------------------------------
*/

function slugify(value) {
    return String(value)
        .toLowerCase()
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .substring(0, 120);
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

    for (const byte of bytes) {
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
