import { createContext, useContext } from 'react';

/** Vrai pour un administrateur connecté : les messages d'indisponibilité en tiennent compte. */
const AdminContext = createContext(false);

export const AdminProvider = AdminContext.Provider;

export const useAdmin = (): boolean => useContext(AdminContext);
