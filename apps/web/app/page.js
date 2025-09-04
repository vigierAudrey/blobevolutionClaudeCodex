import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import Link from 'next/link';
export default function Home() {
    return (_jsxs("div", { className: "max-w-md mx-auto", children: [_jsx("h1", { className: "text-2xl font-semibold mb-4", children: "Bienvenue" }), _jsx("p", { className: "text-sm text-muted-foreground mb-6", children: "Acc\u00E8de \u00E0 ton compte ou cr\u00E9e-en un nouveau. Interface optimis\u00E9e mobile/tablette." }), _jsxs("div", { className: "flex gap-3", children: [_jsx(Link, { href: "/login", className: "inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-4 py-2 w-full sm:w-auto", children: "Se connecter" }), _jsx(Link, { href: "/register", className: "inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 w-full sm:w-auto", children: "Cr\u00E9er un compte" })] })] }));
}
