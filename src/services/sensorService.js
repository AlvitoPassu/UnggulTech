import { supabase } from "../lib/supabase";

export async function getSensors() {
    const { data, error } = await supabase
        .from("sensors")
        .select("id, sensor_name, bedengan, location, status")
        .order("id");

    if (error) throw error;

    return [...data].sort((a, b) => {
        const aBedengan = Number.parseFloat(a.bedengan ?? Number.MAX_SAFE_INTEGER);
        const bBedengan = Number.parseFloat(b.bedengan ?? Number.MAX_SAFE_INTEGER);

        return (Number.isFinite(aBedengan) ? aBedengan : Number.MAX_SAFE_INTEGER)
            - (Number.isFinite(bBedengan) ? bBedengan : Number.MAX_SAFE_INTEGER);
    });
}