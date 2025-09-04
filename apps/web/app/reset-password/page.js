"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Label } from '../../components/ui/label';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
function ResetPasswordInner() {
    const search = useSearchParams();
    const router = useRouter();
    const [token, setToken] = useState('');
    const [password, setPassword] = useState('');
    const [status, setStatus] = useState('idle');
    const [message, setMessage] = useState('');
    useEffect(() => {
        const t = search.get('token');
        if (t)
            setToken(t);
    }, [search]);
    const onSubmit = async (e) => {
        e.preventDefault();
        setStatus('loading');
        setMessage('');
        try {
            await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/auth/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, password }),
            });
            setStatus('done');
            setMessage('Mot de passe mis à jour. Tu peux te connecter.');
        }
        catch (e) {
            setStatus('error');
            setMessage(e?.message || 'Impossible de réinitialiser');
        }
    };
    return (_jsx("div", { className: "max-w-md mx-auto", children: _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "R\u00E9initialiser le mot de passe" }), _jsx(CardDescription, { children: "Colle le token re\u00E7u par email puis saisis ton nouveau mot de passe." })] }), _jsx(CardContent, { children: _jsxs("form", { onSubmit: onSubmit, className: "space-y-4", children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "token", children: "Token" }), _jsx(Input, { id: "token", value: token, onChange: (e) => setToken(e.target.value), required: true })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "password", children: "Nouveau mot de passe" }), _jsx(Input, { id: "password", type: "password", value: password, onChange: (e) => setPassword(e.target.value), required: true })] }), _jsx(Button, { type: "submit", disabled: !token || !password || status === 'loading', className: "w-full", children: status === 'loading' ? 'Mise à jour…' : 'Mettre à jour' }), message && (_jsx("p", { className: `text-sm ${status === 'error' ? 'text-red-600' : 'text-green-600'}`, children: message })), status === 'done' && (_jsx(Button, { type: "button", className: "w-full", onClick: () => router.push('/login'), children: "Aller \u00E0 la connexion" }))] }) })] }) }));
}
export default function ResetPasswordPage() {
    return (_jsx(Suspense, { fallback: _jsx("div", { className: "max-w-md mx-auto", children: "Chargement\u2026" }), children: _jsx(ResetPasswordInner, {}) }));
}
