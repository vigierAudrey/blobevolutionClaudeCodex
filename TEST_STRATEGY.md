# Stratégie de Tests UI/UX - Prévention des Régressions

## Résumé des Modifications et Corrections

### Tests Corrigés ✅

1. **Tests Page d'Accueil** (`apps/web/app/(static)/__tests__/home.page.test.tsx`)
   - **Problème**: Tests échouaient car plusieurs éléments matchaient les requêtes (carousel + sections circuits)
   - **Solution**: Utilisation de `getAllByRole` au lieu de `getByRole` pour gérer les doublons
   - **Exemple**:
     ```typescript
     // Avant (échec)
     expect(screen.getByRole('heading', { name: /Avec un pro/i })).toBeInTheDocument();

     // Après (succès)
     const proHeadings = screen.getAllByRole('heading', { name: /Avec un pro/i });
     expect(proHeadings.length).toBeGreaterThan(0);
     ```

2. **Tests Matching Cards** (`apps/web/app/matching/cards/__tests__/page.test.tsx`)
   - **Problème**: Composant migré de `useMatching` hook vers `optimizedApiClient`
   - **Solutions appliquées**:
     - Suppression du mock obsolète `mockUseMatching`
     - Suppression de la section "Realtime Updates" (fonctionnalité retirée)
     - Ajout de `jest.runAllTimersAsync()` dans les tests utilisant fake timers
   - **Exemple**:
     ```typescript
     await act(async () => {
       renderWithProviders(React.createElement(Page));
     });

     // IMPORTANT: Flush des timers pour permettre le chargement des données
     await act(async () => {
       await jest.runAllTimersAsync();
     });

     await waitFor(() => {
       expect(screen.getByText('Surf Rider')).toBeInTheDocument();
     });
     ```

### Tests Restants à Corriger (10 tests)

Les tests suivants nécessitent encore des ajustements:
- Date Formatting tests (format "anytime", "Aujourd'hui")
- Error Handling tests
- Report Functionality tests
- Decision Queue Processing tests

Ces tests semblent avoir des problèmes de timing avec les mocks de search params.

## Recommandations Stratégiques

### 1. Tests Plus Résilients aux Changements UI

#### Utiliser des data-testid pour les éléments critiques

**Pourquoi**: Les textes et rôles peuvent changer avec les refonte UI, mais les data-testid restent stables.

```typescript
// ❌ Fragile - dépend du texte exact
const button = screen.getByText('Commencer le matching');

// ✅ Robuste - ne dépend pas du texte
const button = screen.getByTestId('matching-cta-button');
```

**Implémentation**:
```tsx
// Dans le composant
<Button data-testid="matching-cta-button">
  Commencer le matching
</Button>

// Dans le test
expect(screen.getByTestId('matching-cta-button')).toBeInTheDocument();
```

#### Utiliser getAllByRole au lieu de getByRole pour les éléments répétés

```typescript
// ❌ Échoue si plusieurs éléments matchent
const heading = screen.getByRole('heading', { name: /Avec un pro/i });

// ✅ Gère les doublons gracieusement
const headings = screen.getAllByRole('heading', { name: /Avec un pro/i });
expect(headings.length).toBeGreaterThan(0);
// ou vérifier un nombre exact si nécessaire
expect(headings).toHaveLength(2);
```

#### Cibler par section avec within()

```typescript
import { within } from '@testing-library/react';

// Cibler une section spécifique
const circuitsSection = screen.getByRole('region', { name: /circuits/i });
const rideHeading = within(circuitsSection).getByRole('heading', { name: /Ride à deux/i });
```

### 2. Gestion des Fake Timers

Quand utiliser `jest.useFakeTimers()`:
- Tests de fonctionnalités avec setTimeout/setInterval
- Tests d'animations avec des délais
- Tests de "undo" ou debounce

**Pattern recommandé**:

```typescript
describe('Feature with Timers', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should work with async data', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    await act(async () => {
      render(<Component />);
    });

    // CRUCIAL: Flush timers pour permettre résolution des Promises
    await act(async () => {
      await jest.runAllTimersAsync();
    });

    // Maintenant les données sont chargées
    await waitFor(() => {
      expect(screen.getByText('Expected Content')).toBeInTheDocument();
    });
  });
});
```

### 3. Documentation des Changements UI

#### Créer un CHANGELOG UI

Documenter les changements significatifs dans `CHANGELOG_UI.md`:

```markdown
## 2025-12-11

### Page d'Accueil
- Ajout du carrousel avec 4 modules (Matching, Cours pro, Promos, Blobosphère)
- Chaque module a maintenant un titre qui peut apparaître dans le carrousel ET les sections circuits
- **Impact tests**: Utiliser `getAllByRole` pour les headings qui apparaissent plusieurs fois

### Pages d'Authentification
- Harmonisation style "Peps" sur /login, /register, /forgot-password, /login-pro
- Ajout de hero sections avec dégradés
- Ajout d'icônes Lucide React dans les cartes
- **Impact tests**: Vérifier que les CTAs redirigent toujours vers /register
```

### 4. Tests Visuels avec Storybook (Recommandé)

Pour éviter les régressions visuelles, considérer l'ajout de Storybook + Chromatic:

```bash
npm install --save-dev @storybook/react @storybook/addon-essentials
npm install --save-dev chromatic
```

**Avantages**:
- Aperçu visuel des composants isolés
- Détection automatique des changements visuels
- Documentation interactive des composants
- Tests visuels de régression

**Exemple de story**:

```typescript
// AuthForm.stories.tsx
import { AuthForm } from './AuthForm';

export default {
  title: 'Components/AuthForm',
  component: AuthForm,
};

export const LoginMode = () => <AuthForm mode="login" />;
export const RegisterMode = () => <AuthForm mode="register" />;
```

### 5. Pattern de Tests Réutilisables

Créer des helpers de test pour les patterns courants:

```typescript
// test-utils/rendering.ts
export function renderWithAllProviders(ui: React.ReactElement) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <ToastProvider>
      <ThemeProvider>
        {children}
      </ThemeProvider>
    </ToastProvider>
  );

  return render(ui, { wrapper: Wrapper });
}

export async function renderWithAsyncData(
  ui: React.ReactElement,
  { useFakeTimers = false } = {}
) {
  if (useFakeTimers) {
    await act(async () => {
      renderWithAllProviders(ui);
    });
    await act(async () => {
      await jest.runAllTimersAsync();
    });
  } else {
    renderWithAllProviders(ui);
  }
}
```

### 6. CI/CD Integration

Ajouter un check dans la CI pour bloquer les PR avec tests échouants:

```yaml
# .github/workflows/test.yml
name: Tests
on: [pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm test -- --coverage
      - name: Block on test failures
        if: failure()
        run: exit 1
```

### 7. Tests E2E avec Playwright

Pour les flux critiques (login, matching, création de compte), ajouter des tests E2E:

```typescript
// tests/e2e/login.spec.ts
import { test, expect } from '@playwright/test';

test('user can login and see dashboard', async ({ page }) => {
  await page.goto('http://localhost:3002/login');

  await page.fill('[name="email"]', 'test@example.com');
  await page.fill('[name="password"]', 'password123');

  await page.click('button[type="submit"]');

  await expect(page).toHaveURL(/.*dashboard/);
  await expect(page.locator('h1')).toContainText('Dashboard');
});
```

## Checklist pour les Futures Refonte UI

Avant de merger une PR avec des changements UI importants:

- [ ] Tous les tests passent
- [ ] Les éléments répétés utilisent `getAllByRole` ou sont identifiés par `data-testid`
- [ ] Les tests avec fake timers incluent `jest.runAllTimersAsync()`
- [ ] Les changements UI sont documentés dans CHANGELOG_UI.md
- [ ] Les stories Storybook sont mises à jour (si applicable)
- [ ] Les screenshots des tests visuels sont revus (si applicable)
- [ ] Les tests E2E des flux critiques passent (si applicable)

## Actions Prioritaires

1. **Court terme** (1-2 jours):
   - ✅ Corriger les tests homepage et matching cards (fait partiellement)
   - ⚠️ Corriger les 10 tests restants dans matching/cards
   - Ajouter `data-testid` aux éléments critiques (CTAs, formulaires)

2. **Moyen terme** (1 semaine):
   - Mettre en place Storybook pour les composants principaux
   - Créer CHANGELOG_UI.md et documenter les récents changements
   - Refactoriser les tests pour utiliser les helpers réutilisables

3. **Long terme** (1 mois):
   - Implémenter les tests E2E avec Playwright
   - Configurer Chromatic pour les tests visuels de régression
   - Intégrer les checks de tests dans la CI/CD

## Ressources

- [Testing Library Best Practices](https://testing-library.com/docs/queries/about/#priority)
- [Storybook Documentation](https://storybook.js.org/)
- [Playwright Testing](https://playwright.dev/)
- [Jest Fake Timers](https://jestjs.io/docs/timer-mocks)
