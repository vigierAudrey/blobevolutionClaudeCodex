"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AuthForm } from '../../components/AuthForm';
export default function LoginPage() {
    return (_jsxs("div", { className: "max-w-md mx-auto", children: [_jsx(AuthForm, { mode: "login" }), _jsx("div", { className: "mt-4 text-center", children: _jsx("a", { href: "/forgot-password", className: "text-sm text-primary underline", children: "Mot de passe oubli\u00E9 ?" }) })] }));
}
