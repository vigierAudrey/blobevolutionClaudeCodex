"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import Link from 'next/link';
import { apiClient } from '../lib/apiClient';
import { useRouter } from 'next/navigation';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
export function AuthForm({ mode }) {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState('RIDER');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [info, setInfo] = useState(null);
    const onSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setInfo(null);
        setLoading(true);
        try {
            if (mode === 'register') {
                const res = await apiClient.register({ email, password, role });
                setInfo('Compte créé. Vérifie ta boîte mail pour valider ton email.');
                // Optionnel: rediriger vers login
                setTimeout(() => router.push('/login'), 800);
            }
            else {
                const res = await apiClient.login({ email, password });
                apiClient.saveTokens(res.accessToken, res.refreshToken);
                router.push('/dashboard');
            }
        }
        catch (err) {
            setError(err?.message || 'Une erreur est survenue');
        }
        finally {
            setLoading(false);
        }
    };
    return (_jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: mode === 'login' ? 'Connexion' : 'Inscription' }), _jsx(CardDescription, { children: mode === 'login' ? 'Accède à ton compte Blobinfini.' : 'Rejoins la communauté Blobinfini.' })] }), _jsxs(CardContent, { children: [_jsxs("form", { onSubmit: onSubmit, className: "space-y-4", children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "email", children: "Email" }), _jsx(Input, { id: "email", type: "email", required: true, autoComplete: "email", value: email, onChange: (e) => setEmail(e.target.value) })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "password", children: "Mot de passe" }), _jsx(Input, { id: "password", type: "password", required: true, autoComplete: mode === 'login' ? 'current-password' : 'new-password', value: password, onChange: (e) => setPassword(e.target.value) })] }), mode === 'register' && (_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "role", children: "R\u00F4le" }), _jsxs("select", { id: "role", className: "h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", value: role, onChange: (e) => setRole(e.target.value), children: [_jsx("option", { value: "RIDER", children: "Rider" }), _jsx("option", { value: "PRO", children: "Pro" })] })] })), error && _jsx("p", { className: "text-sm text-red-600", role: "alert", children: error }), info && _jsx("p", { className: "text-sm text-green-600", children: info }), _jsx(Button, { type: "submit", disabled: loading, className: "w-full", children: loading ? 'En cours…' : mode === 'login' ? 'Se connecter' : 'Créer le compte' })] }), _jsx("div", { className: "mt-4 text-sm text-center text-muted-foreground", children: mode === 'login' ? (_jsxs("span", { children: ["Pas encore de compte ? ", _jsx(Link, { href: "/register", className: "text-primary underline", children: "Inscription" })] })) : (_jsxs("span", { children: ["D\u00E9j\u00E0 un compte ? ", _jsx(Link, { href: "/login", className: "text-primary underline", children: "Connexion" })] })) })] })] }));
}
