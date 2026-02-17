"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";

type Props = {
  name?: string | null;
  role: "ADMIN" | "MEMBER";
};

export function UserMenu({ name, role }: Props) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="glass-chip rounded-full px-3 py-1">
        {name ?? "User"} ({role})
      </span>
      {role === "ADMIN" ? (
        <Link className="glass-button-ghost rounded-md px-3 py-1" href="/admin">
          管理
        </Link>
      ) : null}
      <button
        className="glass-button-ghost rounded-md px-3 py-1"
        onClick={() => void signOut({ callbackUrl: "/login" })}
        type="button"
      >
        ログアウト
      </button>
    </div>
  );
}
