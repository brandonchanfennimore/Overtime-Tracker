// Vercel serverless function: lets admins list, create, edit, and delete users.
// Creating or deleting logins needs Supabase's service role key, which must
// never reach the browser. Set these in Vercel → Project → Settings →
// Environment Variables:
//   SUPABASE_URL               same URL as config.js
//   SUPABASE_SERVICE_ROLE_KEY  Supabase → Project Settings → API Keys → service_role (secret)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Calls Supabase's REST/Auth APIs with the service key. Throws on error.
async function supabase(path, options = {}) {
  const res = await fetch(SUPABASE_URL + path, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: "Bearer " + SERVICE_KEY,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = data && (data.msg || data.message || data.error_description || data.error);
    throw new Error(message || res.statusText);
  }
  return data;
}

// Creates or updates a user's profile row. Throws a readable error for a duplicate employee ID.
async function saveProfile(id, { name, last_name, employee_id }) {
  try {
    await supabase("/rest/v1/profiles", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ id, name, last_name: last_name || "", employee_id }),
    });
  } catch (err) {
    if (/employee_id/.test(err.message)) throw new Error("That employee ID is already in use.");
    throw err;
  }
}

// Returns the signed-in user if their profile has is_admin = true, else null.
async function getAdmin(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer /, "");
  if (!token) return null;
  const res = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + token },
  });
  if (!res.ok) return null;
  const user = await res.json();
  const rows = await supabase("/rest/v1/profiles?select=is_admin&id=eq." + encodeURIComponent(user.id));
  return rows[0] && rows[0].is_admin ? user : null;
}

module.exports = async function handler(req, res) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: "Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." });
  }
  try {
    const admin = await getAdmin(req);
    if (!admin) return res.status(403).json({ error: "Only admins can manage users." });

    if (req.method === "GET") {
      const [auth, profiles] = await Promise.all([
        supabase("/auth/v1/admin/users?per_page=1000"),
        supabase("/rest/v1/profiles?select=id,name,last_name,employee_id,is_admin"),
      ]);
      const profileById = Object.fromEntries(profiles.map((p) => [p.id, p]));
      return res.json(auth.users.map((u) => {
        const p = profileById[u.id] || {};
        return {
          id: u.id, email: u.email, name: p.name || "", last_name: p.last_name || "",
          employee_id: p.employee_id || "", is_admin: !!p.is_admin,
        };
      }));
    }

    if (req.method === "POST") {
      const { name, employee_id, email, password } = req.body || {};
      if (!name || !employee_id || !email || !password) {
        return res.status(400).json({ error: "First name, employee ID, email, and password are all required." });
      }
      const user = await supabase("/auth/v1/admin/users", {
        method: "POST",
        body: JSON.stringify({ email, password, email_confirm: true }),
      });
      try {
        await saveProfile(user.id, req.body);
      } catch (err) {
        // Don't leave a login behind without a profile (e.g. duplicate employee ID).
        await supabase("/auth/v1/admin/users/" + user.id, { method: "DELETE" });
        throw err;
      }
      return res.status(201).json({ id: user.id });
    }

    if (req.method === "PATCH") {
      const { id, name, employee_id, email, password } = req.body || {};
      if (!id || !name || !employee_id || !email) {
        return res.status(400).json({ error: "First name, employee ID, and email are required." });
      }
      await saveProfile(id, req.body);
      const authChanges = { email, email_confirm: true };
      if (password) authChanges.password = password; // blank keeps the current password
      await supabase("/auth/v1/admin/users/" + encodeURIComponent(id), {
        method: "PUT",
        body: JSON.stringify(authChanges),
      });
      return res.status(204).end();
    }

    if (req.method === "DELETE") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "Missing user id." });
      if (id === admin.id) return res.status(400).json({ error: "You can't delete your own account." });
      await supabase("/auth/v1/admin/users/" + encodeURIComponent(id), { method: "DELETE" });
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed." });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
