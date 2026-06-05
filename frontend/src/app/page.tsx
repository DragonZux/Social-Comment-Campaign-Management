"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const token = sessionStorage.getItem("campaign_token");
    if (token) {
      router.replace("/dashboard");
    } else {
      router.replace("/login");
    }
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="flex flex-col items-center space-y-4">
        {/* Animated Loading flat shape */}
        <div className="w-12 h-12 rounded-md bg-[#3B82F6] shadow-none animate-bounce" />
        <p className="font-bold text-lg text-gray-900 tracking-wide">Đang tải DragonZux Social...</p>
      </div>
    </div>
  );
}
