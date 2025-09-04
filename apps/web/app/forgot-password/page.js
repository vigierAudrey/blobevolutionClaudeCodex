"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Label } from '../../components/ui/label';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState('idle');
    const [message, setMessage] = useState('');
    const onSubmit = async (e) => {
        e.preventDefault();
        setStatus('loading');
        setMessage('');
        try {
            await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/auth/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            setStatus('done');
            setMessage('Si le compte existe, un email de réinitialisation a été envoyé.');
        }
        catch (e) {
            setStatus('error');
            setMessage(e?.message || 'Erreur lors de la demande');
        }
    };
    return (_jsx("div", { className: "max-w-md mx-auto", children: _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Mot de passe oubli\u00E9" }), _jsx(CardDescription, { children: "Entre ton email pour recevoir un lien de r\u00E9initialisation." })] }), _jsx(CardContent, { children: _jsxs("form", { onSubmit: onSubmit, className: "space-y-4", children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "email", children: "Email" }), _jsx(Input, { id: "email", type: "email", value: email, onChange: (e) => setEmail(e.target.value), required: true })] }), _jsx(Button, { type: "submit", disabled: !email || status === 'loading', className: "w-full", children: status === 'loading' ? 'Envoi…' : 'Envoyer' }), message && (_jsx("p", { className: `text-sm ${status === 'error' ? 'text-red-600' : 'text-green-600'}`, children: message }))] }) })] }) }));
}
