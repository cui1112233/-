import { useEffect, useState } from 'react';
import { getCurrentUsername } from '../../shared/api/auth';
import { getConfig } from '../../shared/api/config';
import { CmPenguinCompanion } from '../../shared/pet/CmPenguinCompanion';
import { HomePage } from './HomePage';

export function HomeRoute({ isLoggedIn, onOpenLogin, theme }) {
  const username = getCurrentUsername();
  const [petVisible, setPetVisible] = useState(true);

  useEffect(() => {
    function updatePetVisibility(event) {
      setPetVisible(event.detail?.petVisible !== false);
    }

    window.addEventListener('qiantie:notifications-updated', updatePetVisibility);

    let active = true;
    if (isLoggedIn && username) {
      getConfig()
        .then(config => {
          if (active) setPetVisible(config.notifications?.petVisible !== false);
        })
        .catch(() => {});
    }

    return () => {
      active = false;
      window.removeEventListener('qiantie:notifications-updated', updatePetVisibility);
    };
  }, [isLoggedIn, username]);

  return (
    <>
      <HomePage isLoggedIn={isLoggedIn} onOpenLogin={onOpenLogin} theme={theme} />
      {isLoggedIn && username && petVisible ? <CmPenguinCompanion username={username} accountSessionKey={username} /> : null}
    </>
  );
}

export default HomeRoute;
