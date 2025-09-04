import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
export default function PaymentsPage() {
    return (_jsx("div", { className: "max-w-2xl mx-auto", children: _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Paiements" }), _jsx(CardDescription, { children: "Ajoute du cr\u00E9dit \u00E0 ton compte (Stripe \u00E0 venir)." })] }), _jsxs(CardContent, { children: [_jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { variant: "secondary", children: "+10 \u20AC" }), _jsx(Button, { variant: "secondary", children: "+25 \u20AC" }), _jsx(Button, { variant: "secondary", children: "+50 \u20AC" })] }), _jsx("p", { className: "text-sm text-muted-foreground mt-3", children: "Int\u00E9gration Stripe Connect et 3D Secure pr\u00E9vues dans la phase suivante." })] })] }) }));
}
