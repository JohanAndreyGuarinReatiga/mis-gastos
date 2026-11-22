// Configuración pública de Supabase.
// La "publishable key" es pública por diseño: la seguridad la dan las
// políticas RLS definidas en supabase/schema.sql.
// NUNCA pongas aquí la "secret key".
window.APP_CONFIG = {
  SUPABASE_URL: 'https://juwjqbayagcyrfvoegje.supabase.co',
  SUPABASE_KEY: 'sb_publishable_iwlUgmRp1SQKmt5KxBm6iQ_vlHDdfKS',
  BUCKET: 'facturas',
  CATEGORIAS_DEFECTO: [
    { nombre: 'Alimentación', color: '#f59e0b', icono: '🍽️' },
    { nombre: 'Transporte',   color: '#3b82f6', icono: '🚗' },
    { nombre: 'Servicios',    color: '#8b5cf6', icono: '💡' },
    { nombre: 'Salud',        color: '#ef4444', icono: '🩺' },
    { nombre: 'Hogar',        color: '#10b981', icono: '🏠' },
    { nombre: 'Entretenimiento', color: '#ec4899', icono: '🎬' },
    { nombre: 'Otros',        color: '#64748b', icono: '📦' },
  ],
  METODOS_PAGO: ['Efectivo', 'Débito', 'Crédito', 'Transferencia', 'Nequi', 'Daviplata'],
};
