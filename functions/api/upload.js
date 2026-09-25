// functions/api/upload.js

const SESSION_COOKIE = "jaya_admin_session";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif"
};

const ALLOWED_FOLDERS = new Set([
    "services",
    "gallery",
    "pages",
    "branding",
    "seo",
    "uploads"
]);


export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    try {

        /*
        |--------------------------------------------------------------------------
        | POST /api/upload
        |--------------------------------------------------------------------------
        | Upload file ke R2 + simpan metadata ke D1
        |--------------------------------------------------------------------------
        */

        if (
            request.method === "POST" &&
            url.pathname === "/api/upload"
        ) {
            return await uploadFile(
                request,
                env
            );
        }


        /*
        |--------------------------------------------------------------------------
        | GET /api/upload/:id
        |--------------------------------------------------------------------------
        | Mengambil file dari R2 melalui Worker
        |--------------------------------------------------------------------------
        */

        const match =
            url.pathname.match(
                /^\/api\/upload\/(\d+)$/
            );

        if (match) {
            const mediaId =
                Number(match[1]);

            if (
                !Number.isInteger(mediaId) ||
                mediaId <= 0
            ) {
                return jsonResponse(
                    {
                        success: false,
                        message: "ID media tidak valid."
                    },
                    400
                );
            }

            if (
                request.method === "GET"
            ) {
                return await serveFile(
                    request,
                    env,
                    mediaId
                );
            }

            if (
                request.method === "DELETE"
            ) {
                return await deleteFile(
                    request,
                    env,
                    mediaId
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

        console.error(
            "UPLOAD API ERROR:",
            error
        );

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
| UPLOAD FILE
|--------------------------------------------------------------------------
*/

async function uploadFile(
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

    if (!env.R2) {
        return jsonResponse(
            {
                success: false,
                message: "R2 binding belum dikonfigurasi."
            },
            500
        );
    }

    const contentType =
        request.headers.get(
            "Content-Type"
        ) || "";

    if (
        !contentType
            .toLowerCase()
            .startsWith(
                "multipart/form-data"
            )
    ) {
        return jsonResponse(
            {
                success: false,
                message:
                    "Upload harus menggunakan multipart/form-data."
            },
            400
        );
    }


    /*
     * Parse multipart form.
     */

    const formData =
        await request.formData();

    const file =
        formData.get("file");

    const folderInput =
        formData.get("folder");

    const altText =
        cleanString(
            formData.get("alt_text")
        );

    const caption =
        cleanString(
            formData.get("caption")
        );


    /*
     * Pastikan file benar-benar ada.
     */

    if (
        !file ||
        typeof file.arrayBuffer !== "function"
    ) {
        return jsonResponse(
            {
                success: false,
                message: "File belum dipilih."
            },
            400
        );
    }


    /*
     * Folder default.
     */

    const folder =
        normalizeFolder(
            folderInput
        );


    /*
     * Validasi MIME.
     */

    const mimeType =
        String(
            file.type || ""
        ).toLowerCase();

    if (
        !ALLOWED_TYPES[mimeType]
    ) {
        return jsonResponse(
            {
                success: false,
                message:
                    "Format file tidak didukung. Gunakan JPG, PNG, WebP, atau AVIF."
            },
            400
        );
    }


    /*
     * Validasi ukuran.
     */

    const fileSize =
        Number(file.size || 0);

    if (fileSize <= 0) {
        return jsonResponse(
            {
                success: false,
                message: "File kosong atau tidak valid."
            },
            400
        );
    }

    if (
        fileSize > MAX_FILE_SIZE
    ) {
        return jsonResponse(
            {
                success: false,
                message:
                    "Ukuran file maksimal 10 MB."
            },
            413
        );
    }


    /*
     * Ambil nama asli.
     */

    const originalName =
        cleanFilename(
            file.name || "upload"
        );


    /*
     * Generate nama object R2.
     *
     * Kita tidak menggunakan nama file user
     * sebagai nama object utama.
     */

    const extension =
        ALLOWED_TYPES[mimeType];

    const randomId =
        crypto.randomUUID();

    const r2Key =
        `${folder}/${randomId}.${extension}`;


    /*
     * Ambil isi file.
     */

    const arrayBuffer =
        await file.arrayBuffer();


    /*
     * Upload ke R2.
     */

    await env.R2.put(
        r2Key,
        arrayBuffer,
        {
            httpMetadata: {
                contentType: mimeType,
                cacheControl:
                    "public, max-age=31536000, immutable"
            },
            customMetadata: {
                originalName,
                uploadedBy:
                    String(auth.admin.id)
            }
        }
    );


    /*
     * URL disimpan jika PUBLIC_R2_URL
     * dikonfigurasi di Cloudflare.
     *
     * Kalau belum ada, frontend bisa
     * menggunakan /api/upload/:id.
     */

    let publicUrl = null;

    if (env.PUBLIC_R2_URL) {
        publicUrl =
            buildPublicUrl(
                env.PUBLIC_R2_URL,
                r2Key
            );
    }


    /*
     * Simpan metadata ke D1.
     */

    let mediaId = null;

    try {

        const result =
            await env.DB
                .prepare(`
                    INSERT INTO media (
                        file_name,
                        original_name,
                        r2_key,
                        url,
                        mime_type,
                        file_size,
                        width,
                        height,
                        folder,
                        alt_text,
                        caption,
                        uploaded_by
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `)
                .bind(
                    `${randomId}.${extension}`,
                    originalName,
                    r2Key,
                    publicUrl,
                    mimeType,
                    fileSize,
                    null,
                    null,
                    folder,
                    altText || null,
                    caption || null,
                    auth.admin.id
                )
                .run();

        mediaId =
            result.meta.last_row_id;

    } catch (error) {

        /*
         * Jika insert D1 gagal,
         * hapus object yang sudah masuk R2
         * agar tidak meninggalkan file yatim.
         */

        try {
            await env.R2.delete(
                r2Key
            );
        } catch (deleteError) {
            console.error(
                "R2 cleanup failed:",
                deleteError
            );
        }

        throw error;
    }


    /*
     * URL fallback melalui API.
     */

    const apiUrl =
        `/api/upload/${mediaId}`;


    return jsonResponse(
        {
            success: true,
            message:
                "File berhasil diupload.",
            data: {
                id: mediaId,
                file_name:
                    `${randomId}.${extension}`,
                original_name:
                    originalName,
                r2_key:
                    r2Key,
                url:
                    publicUrl || apiUrl,
                api_url:
                    apiUrl,
                mime_type:
                    mimeType,
                file_size:
                    fileSize,
                folder:
                    folder,
                alt_text:
                    altText || null,
                caption:
                    caption || null
            }
        },
        201
    );
}


/*
|--------------------------------------------------------------------------
| SERVE FILE
|--------------------------------------------------------------------------
*/

async function serveFile(
    request,
    env,
    mediaId
) {
    if (!env.R2) {
        return jsonResponse(
            {
                success: false,
                message:
                    "R2 binding belum dikonfigurasi."
            },
            500
        );
    }


    const media =
        await env.DB
            .prepare(`
                SELECT
                    id,
                    file_name,
                    r2_key,
                    mime_type,
                    file_size,
                    alt_text
                FROM media
                WHERE id = ?
                LIMIT 1
            `)
            .bind(mediaId)
            .first();


    if (!media) {
        return new Response(
            "Media tidak ditemukan.",
            {
                status: 404
            }
        );
    }


    /*
     * HEAD request tetap didukung.
     */

    const object =
        await env.R2.get(
            media.r2_key
        );


    if (!object) {
        return new Response(
            "File tidak ditemukan.",
            {
                status: 404
            }
        );
    }


    const headers =
        new Headers();


    /*
     * Content-Type dari database.
     */

    headers.set(
        "Content-Type",
        media.mime_type ||
            "application/octet-stream"
    );


    /*
     * Cache browser/CDN.
     */

    headers.set(
        "Cache-Control",
        "public, max-age=31536000, immutable"
    );


    /*
     * Ukuran file.
     */

    if (
        media.file_size !== null &&
        media.file_size !== undefined
    ) {
        headers.set(
            "Content-Length",
            String(media.file_size)
        );
    }


    /*
     * ETag dari R2.
     */

    if (object.httpEtag) {
        headers.set(
            "ETag",
            object.httpEtag
        );
    }


    /*
     * Last modified.
     */

    if (object.uploaded) {
        headers.set(
            "Last-Modified",
            object.uploaded.toUTCString()
        );
    }


    /*
     * CORS.
     */

    headers.set(
        "Access-Control-Allow-Origin",
        "*"
    );


    /*
     * HEAD tidak mengirim body.
     */

    if (
        request.method === "HEAD"
    ) {
        return new Response(
            null,
            {
                status: 200,
                headers
            }
        );
    }


    return new Response(
        object.body,
        {
            status: 200,
            headers
        }
    );
}


/*
|--------------------------------------------------------------------------
| DELETE FILE
|--------------------------------------------------------------------------
*/

async function deleteFile(
    request,
    env,
    mediaId
) {
    const auth =
        await requireAdmin(
            request,
            env
        );

    if (!auth.authenticated) {
        return auth.response;
    }

    if (!env.R2) {
        return jsonResponse(
            {
                success: false,
                message:
                    "R2 binding belum dikonfigurasi."
            },
            500
        );
    }


    /*
     * Ambil media.
     */

    const media =
        await env.DB
            .prepare(`
                SELECT
                    id,
                    r2_key
                FROM media
                WHERE id = ?
                LIMIT 1
            `)
            .bind(mediaId)
            .first();


    if (!media) {
        return jsonResponse(
            {
                success: false,
                message:
                    "Media tidak ditemukan."
            },
            404
        );
    }


    /*
     * Pastikan media tidak sedang
     * digunakan oleh tabel lain.
     */

    const references =
        await findMediaReferences(
            env,
            mediaId
        );


    if (
        references.length > 0
    ) {
        return jsonResponse(
            {
                success: false,
                message:
                    "Media masih digunakan dan tidak dapat dihapus.",
                references
            },
            409
        );
    }


    /*
     * Hapus object R2.
     */

    await env.R2.delete(
        media.r2_key
    );


    /*
     * Hapus record D1.
     */

    await env.DB
        .prepare(`
            DELETE FROM media
            WHERE id = ?
        `)
        .bind(mediaId)
        .run();


    return jsonResponse({
        success: true,
        message:
            "Media berhasil dihapus."
    });
}


/*
|--------------------------------------------------------------------------
| CHECK MEDIA REFERENCES
|--------------------------------------------------------------------------
*/

async function findMediaReferences(
    env,
    mediaId
) {
    const references = [];


    /*
     * services.image_media_id
     */

    const services =
        await env.DB
            .prepare(`
                SELECT
                    id,
                    name
                FROM services
                WHERE image_media_id = ?
                LIMIT 20
            `)
            .bind(mediaId)
            .all();


    for (
        const item of services.results || []
    ) {
        references.push({
            table: "services",
            id: item.id,
            name: item.name
        });
    }


    /*
     * gallery.image_media_id
     */

    const gallery =
        await env.DB
            .prepare(`
                SELECT
                    id,
                    title
                FROM gallery
                WHERE image_media_id = ?
                LIMIT 20
            `)
            .bind(mediaId)
            .all();


    for (
        const item of gallery.results || []
    ) {
        references.push({
            table: "gallery",
            id: item.id,
            name:
                item.title ||
                `Gallery #${item.id}`
        });
    }


    /*
     * site_settings.logo_media_id
     */

    const logo =
        await env.DB
            .prepare(`
                SELECT id
                FROM site_settings
                WHERE logo_media_id = ?
                LIMIT 1
            `)
            .bind(mediaId)
            .first();


    if (logo) {
        references.push({
            table: "site_settings",
            field: "logo_media_id",
            id: logo.id
        });
    }


    /*
     * site_settings.favicon_media_id
     */

    const favicon =
        await env.DB
            .prepare(`
                SELECT id
                FROM site_settings
                WHERE favicon_media_id = ?
                LIMIT 1
            `)
            .bind(mediaId)
            .first();


    if (favicon) {
        references.push({
            table: "site_settings",
            field: "favicon_media_id",
            id: favicon.id
        });
    }


    /*
     * site_settings.og_image_media_id
     */

    const ogImage =
        await env.DB
            .prepare(`
                SELECT id
                FROM site_settings
                WHERE og_image_media_id = ?
                LIMIT 1
            `)
            .bind(mediaId)
            .first();


    if (ogImage) {
        references.push({
            table: "site_settings",
            field: "og_image_media_id",
            id: ogImage.id
        });
    }


    /*
     * site_content.about_image_media_id
     */

    const aboutImage =
        await env.DB
            .prepare(`
                SELECT id
                FROM site_content
                WHERE about_image_media_id = ?
                LIMIT 1
            `)
            .bind(mediaId)
            .first();


    if (aboutImage) {
        references.push({
            table: "site_content",
            field: "about_image_media_id",
            id: aboutImage.id
        });
    }


    /*
     * process_steps.image_media_id
     */

    const processSteps =
        await env.DB
            .prepare(`
                SELECT
                    id,
                    title
                FROM process_steps
                WHERE image_media_id = ?
                LIMIT 20
            `)
            .bind(mediaId)
            .all();


    for (
        const item of processSteps.results || []
    ) {
        references.push({
            table: "process_steps",
            id: item.id,
            name: item.title
        });
    }


    /*
     * testimonials.photo_media_id
     */

    const testimonials =
        await env.DB
            .prepare(`
                SELECT
                    id,
                    customer_name
                FROM testimonials
                WHERE photo_media_id = ?
                LIMIT 20
            `)
            .bind(mediaId)
            .all();


    for (
        const item of testimonials.results || []
    ) {
        references.push({
            table: "testimonials",
            id: item.id,
            name: item.customer_name
        });
    }


    return references;
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
                    message:
                        "AUTH_SECRET belum dikonfigurasi."
                },
                500
            )
        };
    }


    const cookies =
        parseCookies(
            request.headers.get(
                "Cookie"
            ) || ""
        );


    const token =
        cookies[SESSION_COOKIE];


    if (!token) {
        return {
            authenticated: false,
            response: jsonResponse(
                {
                    success: false,
                    message:
                        "Anda harus login terlebih dahulu."
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
                    message:
                        "Session tidak valid atau sudah kedaluwarsa."
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
                    message:
                        "Akun admin tidak aktif."
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

        if (
            parts.length !== 2
        ) {
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
        new Uint8Array(
            signature
        )
    );
}


/*
|--------------------------------------------------------------------------
| FOLDER
|--------------------------------------------------------------------------
*/

function normalizeFolder(
    value
) {
    const folder =
        cleanString(value)
            .toLowerCase()
            .replace(
                /[^a-z0-9_-]/g,
                ""
            );


    if (
        ALLOWED_FOLDERS.has(folder)
    ) {
        return folder;
    }


    return "uploads";
}


/*
|--------------------------------------------------------------------------
| FILENAME
|--------------------------------------------------------------------------
*/

function cleanFilename(
    filename
) {
    return String(filename)
        .replace(
            /[/\\]/g,
            "_"
        )
        .replace(
            /[^a-zA-Z0-9._-]/g,
            "_"
        )
        .slice(0, 180);
}


/*
|--------------------------------------------------------------------------
| PUBLIC R2 URL
|--------------------------------------------------------------------------
*/

function buildPublicUrl(
    baseUrl,
    key
) {
    return (
        String(baseUrl)
            .replace(/\/+$/, "") +
        "/" +
        key
            .split("/")
            .map(
                encodeURIComponent
            )
            .join("/")
    );
}


/*
|--------------------------------------------------------------------------
| COOKIE
|--------------------------------------------------------------------------
*/

function parseCookies(
    cookieHeader
) {
    const cookies = {};


    cookieHeader
        .split(";")
        .forEach(part => {

            const index =
                part.indexOf("=");

            if (
                index === -1
            ) {
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
                cookies[name] =
                    value;
            }
        });


    return cookies;
}


/*
|--------------------------------------------------------------------------
| BASE64URL
|--------------------------------------------------------------------------
*/

function base64UrlEncode(
    bytes
) {
    let binary = "";


    for (
        const byte of bytes
    ) {
        binary +=
            String.fromCharCode(
                byte
            );
    }


    return btoa(binary)
        .replace(
            /\+/g,
            "-"
        )
        .replace(
            /\//g,
            "_"
        )
        .replace(
            /=+$/g,
            ""
        );
}


function base64UrlDecode(
    value
) {
    let base64 =
        value
            .replace(
                /-/g,
                "+"
            )
            .replace(
                /_/g,
                "/"
            );


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
| CONSTANT TIME COMPARE
|--------------------------------------------------------------------------
*/

function constantTimeEqual(
    a,
    b
) {
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
| STRING
|--------------------------------------------------------------------------
*/

function cleanString(
    value
) {
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
| JSON RESPONSE
|--------------------------------------------------------------------------
*/

function jsonResponse(
    data,
    status = 200
) {
    return new Response(
        JSON.stringify(data),
        {
            status,
            headers: {
                "Content-Type":
                    "application/json; charset=UTF-8",
                "Cache-Control":
                    "no-store"
            }
        }
    );
}
