// functions/api/auth.js

const SESSION_COOKIE = "jaya_admin_session";
const SESSION_DURATION = 8 * 60 * 60; // 8 jam

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    try {
        // POST /api/auth/login
        if (request.method === "POST" && url.pathname === "/api/auth/login") {
            return await login(request, env);
        }

        // GET /api/auth/me
        if (request.method === "GET" && url.pathname === "/api/auth/me") {
            return await getCurrentUser(request, env);
        }

        // POST /api/auth/logout
        if (request.method === "POST" && url.pathname === "/api/auth/logout") {
            return await logout();
        }

        return jsonResponse(
            {
                success: false,
                message: "Endpoint tidak ditemukan."
            },
            404
        );

    } catch (error) {
        console.error("AUTH ERROR:", error);

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
| LOGIN
|--------------------------------------------------------------------------
*/

async function login(request, env) {
    let body;

    try {
        body = await request.json();
    } catch {
        return jsonResponse(
            {
                success: false,
                message: "Format request tidak valid."
            },
            400
        );
    }

    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (!username || !password) {
        return jsonResponse(
            {
                success: false,
                message: "Username dan password wajib diisi."
            },
            400
        );
    }

    // Pastikan environment variables tersedia
    if (
        !env.ADMIN_USERNAME ||
        !env.ADMIN_PASSWORD ||
        !env.AUTH_SECRET
    ) {
        console.error("Authentication secrets belum dikonfigurasi.");

        return jsonResponse(
            {
                success: false,
                message: "Konfigurasi autentikasi belum lengkap."
            },
            500
        );
    }

    /*
     * Bootstrap admin pertama.
     *
     * Jika tabel admins masih kosong, akun dari
     * ADMIN_USERNAME dan ADMIN_PASSWORD akan dibuat
     * secara otomatis dengan password hash.
     */
    const adminCountResult = await env.DB
        .prepare("SELECT COUNT(*) AS total FROM admins")
        .first();

    const adminCount = Number(adminCountResult?.total || 0);

    if (adminCount === 0) {
        if (!constantTimeEqual(username, env.ADMIN_USERNAME)) {
            return invalidLogin();
        }

        if (!constantTimeEqual(password, env.ADMIN_PASSWORD)) {
            return invalidLogin();
        }

        const passwordHash = await hashPassword(password);

        await env.DB
            .prepare(`
                INSERT INTO admins (
                    username,
                    password_hash,
                    name,
                    role,
                    is_active
                )
                VALUES (?, ?, ?, ?, 1)
            `)
            .bind(
                username,
                passwordHash,
                username,
                "admin"
            )
            .run();
    }

    /*
     * Setelah admin tersedia di database,
     * login selalu diverifikasi menggunakan data D1.
     */
    const admin = await env.DB
        .prepare(`
            SELECT
                id,
                username,
                password_hash,
                name,
                email,
                role,
                is_active
            FROM admins
            WHERE username = ?
            LIMIT 1
        `)
        .bind(username)
        .first();

    if (!admin) {
        return invalidLogin();
    }

    if (Number(admin.is_active) !== 1) {
        return jsonResponse(
            {
                success: false,
                message: "Akun admin tidak aktif."
            },
            403
        );
    }

    const passwordValid = await verifyPassword(
        password,
        admin.password_hash
    );

    if (!passwordValid) {
        return invalidLogin();
    }

    // Update waktu login terakhir
    await env.DB
        .prepare(`
            UPDATE admins
            SET last_login_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `)
        .bind(admin.id)
        .run();

    // Buat session token
    const sessionToken = await createSessionToken(
        {
            id: admin.id,
            username: admin.username,
            role: admin.role
        },
        env.AUTH_SECRET
    );

    const cookie = createSessionCookie(sessionToken);

    return jsonResponse(
        {
            success: true,
            message: "Login berhasil.",
            user: {
                id: admin.id,
                username: admin.username,
                name: admin.name,
                email: admin.email,
                role: admin.role
            }
        },
        200,
        {
            "Set-Cookie": cookie
        }
    );
}


/*
|--------------------------------------------------------------------------
| CURRENT USER
|--------------------------------------------------------------------------
*/

async function getCurrentUser(request, env) {
    if (!env.AUTH_SECRET) {
        return jsonResponse(
            {
                success: false,
                message: "AUTH_SECRET belum dikonfigurasi."
            },
            500
        );
    }

    const cookies = parseCookies(
        request.headers.get("Cookie") || ""
    );

    const token = cookies[SESSION_COOKIE];

    if (!token) {
        return jsonResponse(
            {
                success: false,
                authenticated: false,
                message: "Belum login."
            },
            401
        );
    }

    const session = await verifySessionToken(
        token,
        env.AUTH_SECRET
    );

    if (!session) {
        return jsonResponse(
            {
                success: false,
                authenticated: false,
                message: "Session tidak valid atau sudah kedaluwarsa."
            },
            401
        );
    }

    // Pastikan admin masih ada dan masih aktif
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
        return jsonResponse(
            {
                success: false,
                authenticated: false,
                message: "Akun tidak ditemukan atau tidak aktif."
            },
            401
        );
    }

    return jsonResponse({
        success: true,
        authenticated: true,
        user: {
            id: admin.id,
            username: admin.username,
            name: admin.name,
            email: admin.email,
            role: admin.role
        }
    });
}


/*
|--------------------------------------------------------------------------
| LOGOUT
|--------------------------------------------------------------------------
*/

async function logout() {
    const cookie = [
        `${SESSION_COOKIE}=`,
        "Path=/",
        "HttpOnly",
        "Secure",
        "SameSite=Lax",
        "Max-Age=0"
    ].join("; ");

    return jsonResponse(
        {
            success: true,
            message: "Logout berhasil."
        },
        200,
        {
            "Set-Cookie": cookie
        }
    );
}


/*
|--------------------------------------------------------------------------
| PASSWORD HASH
|--------------------------------------------------------------------------
|
| PBKDF2-SHA256
| 120.000 iterations
|
*/

async function hashPassword(password) {
    const encoder = new TextEncoder();

    const salt = crypto.getRandomValues(
        new Uint8Array(16)
    );

    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        {
            name: "PBKDF2"
        },
        false,
        ["deriveBits"]
    );

    const hashBuffer = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt,
            iterations: 120000,
            hash: "SHA-256"
        },
        keyMaterial,
        256
    );

    return [
        "pbkdf2",
        "sha256",
        "120000",
        base64UrlEncode(salt),
        base64UrlEncode(
            new Uint8Array(hashBuffer)
        )
    ].join("$");
}


/*
|--------------------------------------------------------------------------
| PASSWORD VERIFY
|--------------------------------------------------------------------------
*/

async function verifyPassword(password, storedHash) {
    try {
        const parts = storedHash.split("$");

        if (parts.length !== 5) {
            return false;
        }

        const [
            algorithm,
            hashAlgorithm,
            iterationsString,
            saltEncoded,
            hashEncoded
        ] = parts;

        if (
            algorithm !== "pbkdf2" ||
            hashAlgorithm !== "sha256"
        ) {
            return false;
        }

        const iterations = Number(iterationsString);

        if (!Number.isInteger(iterations) || iterations <= 0) {
            return false;
        }

        const salt = base64UrlDecode(saltEncoded);
        const expectedHash = base64UrlDecode(hashEncoded);

        const encoder = new TextEncoder();

        const keyMaterial = await crypto.subtle.importKey(
            "raw",
            encoder.encode(password),
            {
                name: "PBKDF2"
            },
            false,
            ["deriveBits"]
        );

        const hashBuffer = await crypto.subtle.deriveBits(
            {
                name: "PBKDF2",
                salt,
                iterations,
                hash: "SHA-256"
            },
            keyMaterial,
            256
        );

        const actualHash = new Uint8Array(hashBuffer);

        return constantTimeBytesEqual(
            actualHash,
            expectedHash
        );

    } catch {
        return false;
    }
}


/*
|--------------------------------------------------------------------------
| SESSION TOKEN
|--------------------------------------------------------------------------
|
| Format:
| base64url(payload).base64url(signature)
|
*/

async function createSessionToken(payload, secret) {
    const now = Math.floor(Date.now() / 1000);

    const sessionPayload = {
        ...payload,
        iat: now,
        exp: now + SESSION_DURATION
    };

    const payloadString = JSON.stringify(
        sessionPayload
    );

    const encodedPayload = base64UrlEncode(
        new TextEncoder().encode(payloadString)
    );

    const signature = await signHmac(
        encodedPayload,
        secret
    );

    return `${encodedPayload}.${signature}`;
}


/*
|--------------------------------------------------------------------------
| VERIFY SESSION TOKEN
|--------------------------------------------------------------------------
*/

async function verifySessionToken(token, secret) {
    try {
        const parts = token.split(".");

        if (parts.length !== 2) {
            return null;
        }

        const [
            encodedPayload,
            signature
        ] = parts;

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
| COOKIE
|--------------------------------------------------------------------------
*/

function createSessionCookie(token) {
    return [
        `${SESSION_COOKIE}=${token}`,
        "Path=/",
        "HttpOnly",
        "Secure",
        "SameSite=Lax",
        `Max-Age=${SESSION_DURATION}`
    ].join("; ");
}


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
| CONSTANT-TIME COMPARISON
|--------------------------------------------------------------------------
*/

function constantTimeEqual(a, b) {
    const encoder = new TextEncoder();

    return constantTimeBytesEqual(
        encoder.encode(a),
        encoder.encode(b)
    );
}


function constantTimeBytesEqual(a, b) {
    if (a.length !== b.length) {
        return false;
    }

    let result = 0;

    for (let i = 0; i < a.length; i++) {
        result |= a[i] ^ b[i];
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


/*
|--------------------------------------------------------------------------
| INVALID LOGIN
|--------------------------------------------------------------------------
*/

function invalidLogin() {
    return jsonResponse(
        {
            success: false,
            message: "Username atau password salah."
        },
        401
    );
}
