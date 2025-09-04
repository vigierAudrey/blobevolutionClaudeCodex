"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
function VerifyInner() {
    const search = useSearchParams();
    const router = useRouter();
    const [token, setToken] = useState('');
    const [status, setStatus] = useState('idle');
    const [message, setMessage] = useState('');
    useEffect(() => {
        const t = search.get('token');
        if (t) {
            setToken(t);
            void verify(t);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const verify = async (t) => {
        setStatus('loading');
        setMessage('');
        try {
            await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/auth/verify-email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: t }),
            });
            setStatus('success');
            setMessage('Email vérifié avec succès. Tu peux te connecter.');
        }
        catch (e) {
            setStatus('error');
            setMessage(e?.message || 'Impossible de vérifier le token');
        }
    };
    const onSubmit = async (e) => {
        e.preventDefault();
        if (!token)
            return;
        await verify(token);
    };
    return (_jsx("div", { className: "max-w-md mx-auto", children: _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "V\u00E9rification de l\u2019email" }), _jsx(CardDescription, { children: "Cette page confirme la validation de ton compte." })] }), _jsx(CardContent, { children: _jsxs("form", { onSubmit: onSubmit, className: "space-y-4", children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "token", children: "Token" }), _jsx(Input, { id: "token", value: token, onChange: (e) => setToken(e.target.value), placeholder: "colle le token ici si besoin" })] }), _jsx(Button, { type: "submit", disabled: !token || status === 'loading', className: "w-full", children: status === 'loading' ? 'Vérification…' : 'Vérifier' }), message && (_jsx("p", { className: `text-sm ${status === 'success' ? 'text-green-600' : status === 'error' ? 'text-red-600' : 'text-muted-foreground'}`, children: message })), status === 'success' && (_jsx(Button, { type: "button", className: "w-full", onClick: () => router.push('/login'), children: "Aller \u00E0 la connexion" }))] }) })] }) }));
}
export default function VerifyPage() {
    return (_jsx(Suspense, { fallback: _jsx("div", { className: "max-w-md mx-auto", children: "Chargement\u2026" }), children: _jsx(VerifyInner, {}) }));
}
