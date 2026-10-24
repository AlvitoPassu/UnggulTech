import { createClient } from "@supabase/supabase-js";
import { createCandidateAuth } from "./candidateAuth";

const rawUrl = import.meta.env.VITE_SUPABASE_URL || "";
// Normalisasi URL jika VITE_SUPABASE_URL tidak sengaja menyertakan path /rest/v1/
const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, "");
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Operator password login is admitted explicitly before setSession. URL
    // grants must not silently replace a shared admitted provider session.
    detectSessionInUrl: false,
  },
});

export const createLoginCandidate = () => createCandidateAuth(supabaseUrl, supabaseAnonKey);
