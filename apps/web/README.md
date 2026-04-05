# React Frontend

`apps/web` это новый SPA-клиент для отделения интерфейса от серверного рантайма.

## Принципы

- frontend знает только о `FastAPI`-контракте и ходит в `/api/v1`
- весь сетевой код централизован в `src/shared/api`
- UI разбит на слои `app`, `pages`, `widgets`, `shared`
- legacy-Flask UI больше не нужен как основной рендер-слой

## Что уже есть

- Vite + React + TypeScript каркас
- центральный API client
- стартовый dashboard для проверки связности frontend и backend
- production-ready Dockerfile для сборки статического SPA
