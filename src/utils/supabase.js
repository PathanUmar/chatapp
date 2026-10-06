import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const createSupabaseClient = (getToken) =>
  createClient(supabaseUrl, supabaseKey, {
    accessToken: async () => {
      return await getToken({ template: "supabase" });
    },
  });
