import {useEffect, useState} from "react";

function detectMobile() {
    try {
        if (typeof window === "undefined") return false;
        const coarse = !!window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
        const small = window.innerWidth <= 768;
        return !!(coarse || small);
    } catch {
        return false;
    }
}

export default function useIsMobile() {
    const [isMobile, setIsMobile] = useState(() => detectMobile());

    useEffect(() => {
        function check() {
            setIsMobile(detectMobile());
        }

        if (typeof window !== "undefined") {
            window.addEventListener("resize", check);
            return () => window.removeEventListener("resize", check);
        }
    }, []);

    return isMobile;
}
