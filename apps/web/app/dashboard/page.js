"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '../../lib/apiClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import Link from 'next/link';
import { User, Map, CreditCard, Percent, Info, LogOut } from 'lucide-react';
export default function DashboardPage() {
    const router = useRouter();
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showProfilePrompt, setShowProfilePrompt] = useState(false);
    useEffect(() => {
        const t = apiClient.getTokens();
        if (!t?.accessToken) {
            router.replace('/login');
            return;
        }
        apiClient
            .me()
            .then((u) => {
            setUser(u);
            // First-login banner heuristic: show once per user until dismissed
            const key = `visited-dashboard-${u?.id}`;
            const visited = typeof window !== 'undefined' ? localStorage.getItem(key) : '1';
            if (!visited)
                setShowProfilePrompt(true);
            if (typeof window !== 'undefined')
                localStorage.setItem(key, '1');
        })
            .finally(() => setLoading(false));
    }, [router]);
    const role = user?.role;
    const logout = async () => {
        try {
            await apiClient.logoutAll();
        }
        catch (_) { }
        apiClient.clearTokens();
        router.replace('/login');
    };
    if (loading)
        return _jsx("p", { children: "Chargement\u2026" });
    if (!user)
        return null;
    // Riders (particuliers): show full dashboard
    const isRider = role === 'RIDER' || !role;
    return (_jsxs("div", { className: "mx-auto max-w-3xl space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-semibold", children: "Tableau de bord" }), _jsxs("p", { className: "text-sm text-muted-foreground", children: ["Bienvenue, ", user?.email] })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Link, { href: "/account", className: "text-sm underline text-primary", children: "Mon compte" }), _jsxs(Button, { variant: "destructive", onClick: logout, className: "inline-flex items-center gap-2", children: [_jsx(LogOut, { size: 16 }), " D\u00E9connexion"] })] })] }), isRider ? (_jsxs(_Fragment, { children: [showProfilePrompt && (_jsxs("div", { className: "rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900", children: ["Premi\u00E8re connexion d\u00E9tect\u00E9e. Pense \u00E0 compl\u00E9ter ton profil pour un meilleur matching.", _jsxs("div", { className: "mt-2 flex gap-2", children: [_jsx(Link, { href: "/profile", className: "underline text-amber-900", children: "Compl\u00E9ter mon profil" }), _jsx("button", { onClick: () => setShowProfilePrompt(false), className: "underline", children: "Plus tard" })] })] })), !user?.emailVerified && (_jsxs("div", { className: "rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-900", children: ["Ton email n\u2019est pas encore v\u00E9rifi\u00E9. Pense \u00E0 confirmer ton adresse pour s\u00E9curiser ton compte.", _jsx("div", { className: "mt-2", children: _jsx(Link, { className: "underline", href: "/account", children: "Voir mon compte" }) })] })), _jsxs("div", { className: "grid grid-cols-1 sm:grid-cols-2 gap-4", children: [_jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsxs(CardTitle, { className: "flex items-center gap-2", children: [_jsx(User, { size: 18 }), " Profil"] }), _jsx(CardDescription, { children: "Cr\u00E9e ou mets \u00E0 jour tes infos" })] }), _jsx(CardContent, { children: _jsx(Link, { href: "/profile", className: "inline-block w-full", children: _jsx(Button, { className: "w-full", children: "Compl\u00E9ter mon profil" }) }) })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsxs(CardTitle, { className: "flex items-center gap-2", children: [_jsx(Map, { size: 18 }), " Matching"] }), _jsx(CardDescription, { children: "Trouve des partenaires proches" })] }), _jsx(CardContent, { children: _jsx(Link, { href: "/matching", className: "inline-block w-full", children: _jsx(Button, { className: "w-full", variant: "secondary", children: "Acc\u00E9der au matching" }) }) })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsxs(CardTitle, { className: "flex items-center gap-2", children: [_jsx(CreditCard, { size: 18 }), " Paiements"] }), _jsx(CardDescription, { children: "Ajoute du cr\u00E9dit \u00E0 ton compte" })] }), _jsx(CardContent, { children: _jsx(Link, { href: "/payments", className: "inline-block w-full", children: _jsx(Button, { className: "w-full", variant: "outline", children: "Ajouter du cr\u00E9dit" }) }) })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsxs(CardTitle, { className: "flex items-center gap-2", children: [_jsx(Percent, { size: 18 }), " Offres"] }), _jsx(CardDescription, { children: "Promotions et avantages" })] }), _jsx(CardContent, { children: _jsx(Link, { href: "/promos", className: "inline-block w-full", children: _jsx(Button, { className: "w-full", variant: "outline", children: "Voir les offres" }) }) })] }), _jsxs(Card, { className: "sm:col-span-2", children: [_jsxs(CardHeader, { children: [_jsxs(CardTitle, { className: "flex items-center gap-2", children: [_jsx(Info, { size: 18 }), " \u00C0 propos & RGPD"] }), _jsx(CardDescription, { children: "Comprendre l\u2019utilisation des donn\u00E9es, la s\u00E9curit\u00E9 et le fonctionnement du site." })] }), _jsx(CardContent, { children: _jsx(Link, { href: "/about", className: "inline-block w-full sm:w-auto", children: _jsx(Button, { children: "En savoir plus" }) }) })] })] })] })) : (_jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Espace Professionnel" }), _jsx(CardDescription, { children: "Interface d\u00E9di\u00E9e en pr\u00E9paration (planning, r\u00E9servations, paiements pro, offres\u2026)" })] }), _jsx(CardContent, { children: _jsx("p", { className: "text-sm text-muted-foreground", children: "Reviens bient\u00F4t \u2014 ou contacte le support pour en savoir plus." }) })] }))] }));
}
