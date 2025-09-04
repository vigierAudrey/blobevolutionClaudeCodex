import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
export default function MatchingPage() {
    return (_jsx("div", { className: "max-w-2xl mx-auto", children: _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Matching" }), _jsx(CardDescription, { children: "Cette section affichera les partenaires proches selon ton profil et ta g\u00E9olocalisation." })] }), _jsx(CardContent, { children: _jsx("p", { className: "text-sm text-muted-foreground", children: "\u00C0 venir: carte interactive, filtres par niveau/disponibilit\u00E9s, et suggestions." }) })] }) }));
}
