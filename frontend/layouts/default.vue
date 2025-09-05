<template>
  <div class="app-container">
    <!-- Global Header -->
    <header class="global-header">
      <div class="header-content">
        <NuxtLink to="/" class="app-title-link">
          <h1 class="app-title">nona-metadata</h1>
        </NuxtLink>
      </div>
    </header>

    <!-- Page Content -->
    <main class="page-content">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.app-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.global-header {
  top: 0;
  z-index: 50;
}

.header-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0.75rem 1rem;
}

@media (min-width: 768px) {
  .header-content {
    padding: 1rem 1.5rem;
  }
}

.app-title-link {
  text-decoration: none;
  color: inherit;
}

.app-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: white;
  margin: 0;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

@media (min-width: 768px) {
  .app-title {
    font-size: 1.5rem;
  }
}

.app-title:hover {
  opacity: 0.9;
}

.page-content {
  flex: 1;
  padding: 1rem;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

@media (min-width: 768px) {
  .page-content {
    padding: 2rem 1.5rem;
  }
}

@media (min-width: 1024px) {
  .page-content {
    padding: 2rem;
  }
}
</style>
