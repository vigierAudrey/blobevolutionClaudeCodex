"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { apiClient } from '../../lib/apiClient';
import { useRouter } from 'next/navigation';
export default function AccountPage() {
    const router = useRouter();
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [info, setInfo] = useState(null);
    useEffect(() => {
        const t = apiClient.getTokens();
        if (!t?.accessToken) {
            router.replace('/login');
            return;
        }
        apiClient
            .me()
            .then(setUser)
            .catch((e) => setError(e?.message || 'Erreur'))
            .finally(() => setLoading(false));
    }, [router]);
    const logout = async () => {
        try {
            await apiClient.logoutAll();
        }
        catch (_) { }
        apiClient.clearTokens();
        router.replace('/login');
    };
    const resend = async () => {
        if (!user?.email)
            return;
        setInfo(null);
        try {
            await apiClient.resendVerification(user.email);
            setInfo('Email de vérification renvoyé. Vérifie ta boîte mail.');
        }
        catch (e) {
            setError(e?.message || 'Erreur lors de l’envoi');
        }
    };
    if (loading)
        return _jsx("p", { children: "Chargement\u2026" });
    if (error)
        return _jsx("p", { className: "text-red-600", children: error });
    return (_jsxs("div", { className: "max-w-md mx-auto space-y-4", children: [_jsx("h1", { className: "text-2xl font-semibold", children: "Mon compte" }), _jsxs("div", { className: "bg-white shadow-sm rounded-lg p-4 sm:p-6", children: [_jsxs("div", { className: "space-y-1 text-sm", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-gray-600", children: "Email" }), _jsx("span", { className: "font-medium", children: user?.email })] }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-gray-600", children: "R\u00F4le" }), _jsx("span", { className: "font-medium", children: user?.role })] }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-gray-600", children: "Email v\u00E9rifi\u00E9" }), _jsx("span", { className: `font-medium ${user?.emailVerified ? 'text-green-600' : 'text-yellow-700'}`, children: user?.emailVerified ? 'Oui' : 'Non' })] })] }), !user?.emailVerified && (_jsx("div", { className: "mt-4", children: _jsx("button", { onClick: resend, className: "w-full inline-flex items-center justify-center rounded-md border border-gray-300 px-4 py-2", children: "Renvoyer l\u2019email de v\u00E9rification" }) })), info && _jsx("p", { className: "text-sm text-green-600 mt-3", children: info })] }), _jsx("button", { onClick: logout, className: "w-full inline-flex items-center justify-center rounded-md bg-red-600 px-4 py-2 text-white", children: "Se d\u00E9connecter" })] }));
}
