import { supabase } from "../lib/supabase";

export async function getSensors() {
    const { data, error } = await supabase
        .from("sensors")
        .select("*")
        .order("id");

        if (error) throw error;

        return data;
}