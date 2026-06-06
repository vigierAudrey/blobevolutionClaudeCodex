const tags = ['HOURTIN', 'CARCANS', 'LACANAU', 'BORDEAUX'];

function OceanLines() {
  return (
    <svg
      className="absolute inset-x-0 bottom-0 h-[72px] w-full text-[#b9dcdd] sm:h-24 lg:h-28"
      viewBox="0 0 1440 160"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      focusable="false"
    >
      <path
        d="M0 86 C160 58 274 118 436 88 C598 58 710 80 858 98 C1010 116 1122 52 1278 78 C1352 90 1404 96 1440 90"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path
        d="M0 118 C132 102 246 126 382 112 C520 98 620 78 760 104 C900 130 1010 126 1140 102 C1264 80 1354 104 1440 96"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.38"
      />
      <path
        d="M0 142 C188 128 308 148 456 134 C640 116 780 136 938 148 C1098 160 1234 130 1440 138"
        fill="none"
        stroke="hsl(var(--blob-yellow))"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.42"
      />
    </svg>
  );
}

export function HomeOceanTransition() {
  return (
    <section
      aria-labelledby="home-ocean-transition-title"
      className="home-ocean-transition -mx-4 overflow-hidden bg-blob-sand sm:-mx-6 lg:-mx-8"
    >
      <div className="relative flex min-h-[150px] items-center px-4 py-5 sm:min-h-[164px] sm:px-6 sm:py-6 lg:min-h-[188px] lg:px-10 lg:py-7 xl:px-14">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_72%_100%,rgba(185,220,221,0.42),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0)_0%,rgba(185,220,221,0.16)_100%)]" aria-hidden />
        <OceanLines />

        <div className="relative z-10 grid w-full max-w-6xl gap-4 lg:grid-cols-[minmax(0,0.82fr)_minmax(360px,1fr)] lg:items-center lg:gap-10">
          <div>
            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-blob-black/58 sm:text-[11px]">
              PREMIÈRE ZONE DE TEST
            </p>
            <h2
              id="home-ocean-transition-title"
              className="max-w-xl text-xl font-black leading-tight tracking-normal text-blob-black sm:text-2xl lg:text-[28px]"
            >
              On commence là où la communauté ride déjà.
            </h2>
          </div>

          <div className="border-blob-yellow/50 lg:border-l lg:pl-8">
            <p className="max-w-2xl text-xs leading-relaxed text-blob-black/64 sm:text-sm">
              Blob démarre entre Hourtin, Carcans, Lacanau et Bordeaux pour tester une idée simple : mieux connecter les riders, les pros et les bons plans utiles à l’échelle locale.
            </p>
            <p
              className="home-city-list mt-3 flex flex-wrap gap-x-1.5 gap-y-1 text-[10px] font-black uppercase leading-relaxed tracking-[0.12em] text-blob-black/64 sm:text-[11px]"
              aria-label={tags.join(' • ')}
            >
              {tags.map((tag, index) => (
                <span key={tag} className="home-city-token" style={{ animationDelay: `${180 + index * 110}ms` }}>
                  {index > 0 && <span aria-hidden>• </span>}
                  {tag}
                </span>
              ))}
            </p>
          </div>
        </div>
      </div>
      <style>{`
        .home-ocean-transition svg {
          animation: homeOceanDrift 18s ease-in-out infinite alternate;
          transform-origin: center;
        }

        .home-city-token {
          animation: homeCityReveal 700ms ease-out both;
        }

        @keyframes homeOceanDrift {
          from {
            transform: translate3d(-8px, 0, 0);
          }
          to {
            transform: translate3d(8px, 0, 0);
          }
        }

        @keyframes homeCityReveal {
          from {
            opacity: 0;
            transform: translate3d(0, 6px, 0);
          }
          to {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .home-ocean-transition svg,
          .home-city-token {
            animation: none;
          }
        }
      `}</style>
    </section>
  );
}
