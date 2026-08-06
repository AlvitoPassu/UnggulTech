import axios from "axios";


const API_URL = "http://localhost:3000";


export const getSensorData = async () => {

    try {

        const response = await axios.get(
            `${API_URL}/api/sensor`
        );

        return response.data;

    } catch(error){

        console.error(
            "Gagal mengambil data sensor",
            error
        );

    }

};