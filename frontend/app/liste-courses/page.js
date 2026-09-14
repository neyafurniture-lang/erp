'use client';

import PurchasesPage from '../purchases/page';

/** Alias mobile-friendly : liste de courses atelier (motion via purchases) */
export default function ListeCoursesPage() {
  return (
    <div className="neya-enter-fade">
      <PurchasesPage />
    </div>
  );
}
