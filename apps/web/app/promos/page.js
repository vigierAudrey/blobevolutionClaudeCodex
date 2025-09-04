import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
export default function PromosPage() {
    return (_jsx("div", { className: "max-w-2xl mx-auto", children: _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Offres promotionnelles" }), _jsx(CardDescription, { children: "Retrouve ici des promos temporaires sur les sessions et \u00E9quipements." })] }), _jsx(CardContent, { children: _jsxs("ul", { className: "list-disc pl-5 text-sm", children: [_jsx("li", { children: "-10% sur ta prochaine session (code: BLOB10)" }), _jsx("li", { children: "Parraine un ami: 5\u20AC offerts chacun" }), _jsx("li", { children: "Pack d\u00E9couverte Kite: -15% jusqu\u2019\u00E0 dimanche" })] }) })] }) }));
}
