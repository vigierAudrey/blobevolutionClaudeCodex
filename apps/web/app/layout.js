import { jsx as _jsx } from "react/jsx-runtime";
import './globals.css';
export const metadata = {
    title: 'Blobinfini — Auth',
    description: 'Inscription, connexion et gestion du compte',
};
export default function RootLayout({ children }) {
    return (_jsx("html", { lang: "fr", children: _jsx("body", { className: "min-h-screen bg-gray-50 text-gray-900", children: _jsx("main", { className: "container-responsive py-6 sm:py-10", children: children }) }) }));
}
