"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Отдельного экрана «Роли» нет — управление ролями живёт вкладкой в /settings/system.
// Этот маршрут существует, чтобы прямой переход на /settings/roles не давал 404,
// а вёл на нужную вкладку.
export default function RolesRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings/system?tab=roles");
  }, [router]);
  return null;
}
