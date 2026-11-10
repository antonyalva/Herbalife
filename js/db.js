import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// Cliente del catálogo público: siempre anónimo, aunque en este navegador haya una sesión iniciada en la app.
// (Con la sesión de un usuario, la base de datos solo deja ver SUS productos y el catálogo de otra tienda sale vacío.)
export const supabasePublic = configured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null;
