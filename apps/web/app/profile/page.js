"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Label } from '../../components/ui/label';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Button } from '../../components/ui/button';
export default function ProfilePage() {
    // Photo upload + preview
    const [photoUrl, setPhotoUrl] = useState(null);
    const [photoFile, setPhotoFile] = useState(null);
    const onPickPhoto = (e) => {
        const f = e.target.files?.[0];
        if (!f)
            return;
        setPhotoFile(f);
        const url = URL.createObjectURL(f);
        setPhotoUrl(url);
    };
    // Form fields
    const [sex, setSex] = useState('Femme');
    const [displayName, setDisplayName] = useState('');
    const [bio, setBio] = useState('');
    const [partnerPref, setPartnerPref] = useState('ALL');
    const [maxDistance, setMaxDistance] = useState(20);
    const [emailNotif, setEmailNotif] = useState(false);
    const onSubmit = (e) => {
        e.preventDefault();
        // TODO: brancher API profils (RiderProfile) quand disponible
        alert('Profil sauvegardé (stub). Les données seront envoyées côté API lors de la prochaine étape.');
    };
    return (_jsxs("div", { className: "mx-auto max-w-5xl space-y-6", children: [_jsxs("div", { className: "text-center space-y-1", children: [_jsx("h1", { className: "text-2xl sm:text-3xl font-semibold", children: "Modifier mon Profil \uD83C\uDFC4\u200D\u2640\uFE0F" }), _jsx("p", { className: "text-sm text-muted-foreground", children: "Personnalise ton profil et choisis tes pr\u00E9f\u00E9rences de session." })] }), _jsxs("form", { onSubmit: onSubmit, className: "space-y-6", children: [_jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { className: "text-base", children: "\uD83D\uDCF8 Charger sa photo" }) }), _jsx(CardContent, { children: _jsxs("div", { className: "flex flex-col items-center gap-4", children: [_jsx("div", { className: "rounded-xl border-2 border-rose-300 p-1", children: _jsx("div", { className: "h-48 w-36 sm:h-56 sm:w-44 overflow-hidden rounded-lg bg-muted flex items-center justify-center", children: photoUrl ? (
                                                        // eslint-disable-next-line @next/next/no-img-element
                                                        _jsx("img", { src: photoUrl, alt: "Photo profil", className: "h-full w-full object-cover" })) : (_jsx("span", { className: "text-xs text-muted-foreground", children: "Aper\u00E7u" })) }) }), _jsx("input", { type: "file", accept: "image/*", onChange: onPickPhoto, className: "block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-secondary-foreground hover:file:bg-secondary/80" }), _jsxs("div", { className: "w-full", children: [_jsx(Label, { htmlFor: "sex", children: "Sexe" }), _jsxs("select", { id: "sex", className: "mt-1 h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", value: sex, onChange: (e) => setSex(e.target.value), children: [_jsx("option", { children: "Femme" }), _jsx("option", { children: "Homme" }), _jsx("option", { children: "Autre" }), _jsx("option", { children: "Ne pas pr\u00E9ciser" })] })] })] }) })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { className: "text-base", children: "\uD83D\uDCCC Nom \u00E0 afficher dans le Matching" }), _jsx(CardDescription, { children: "Ce nom sera visible par tes partenaires potentiels lors des sessions." })] }), _jsxs(CardContent, { className: "space-y-4", children: [_jsx(Input, { placeholder: "Exemple : Blobmama", value: displayName, onChange: (e) => setDisplayName(e.target.value) }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "bio", children: "Ta pr\u00E9sentation" }), _jsx(Textarea, { id: "bio", placeholder: 'Exemple : Je surf depuis trois ans et je suis plutôt shortboard. Je suis une lève-tôt, je préfère les sessions matinales. Maman à mi-temps, une autre BlobMama ici pour aller surfer ?', value: bio, onChange: (e) => setBio(e.target.value) })] })] })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { className: "text-base", children: "Pr\u00E9f\u00E9rences de Session" }) }), _jsxs(CardContent, { className: "space-y-4", children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "partnerPref", children: "S\u00E9lection du partenaire" }), _jsxs("select", { id: "partnerPref", className: "h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", value: partnerPref, onChange: (e) => setPartnerPref(e.target.value), children: [_jsx("option", { value: "ALL", children: "Peu importe" }), _jsx("option", { value: "WOMEN", children: "Uniquement les femmes" }), _jsx("option", { value: "MEN", children: "Uniquement les hommes" })] }), _jsx("p", { className: "text-xs text-amber-700", children: "\u26A0\uFE0F Plus la s\u00E9lection est restrictive, moins tu as de chance de trouver un partenaire." })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "distance", children: "Distance maximale (km)" }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("input", { id: "distance", type: "range", min: 5, max: 200, step: 5, value: maxDistance, onChange: (e) => setMaxDistance(Number(e.target.value)), className: "w-full" }), _jsx(Input, { type: "number", min: 1, max: 500, value: maxDistance, onChange: (e) => setMaxDistance(Number(e.target.value)), className: "w-20" })] })] }), _jsx("p", { className: "text-sm text-muted-foreground", children: "\u2B50 La s\u00E9lection de la tranche d\u2019\u00E2ge sera disponible dans une prochaine version." }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { id: "emailNotif", type: "checkbox", checked: emailNotif, onChange: (e) => setEmailNotif(e.target.checked) }), _jsx(Label, { htmlFor: "emailNotif", className: "!m-0", children: "Recevoir des emails lorsqu\u2019un partenaire cherche \u00E0 me joindre" })] })] })] }), _jsx("div", { className: "flex justify-end", children: _jsx(Button, { type: "submit", className: "w-full sm:w-auto", children: "Enregistrer" }) })] })] }));
}
