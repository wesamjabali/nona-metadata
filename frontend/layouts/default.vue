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
  padding: 1rem 1.5rem;
}

.app-title-link {
  text-decoration: none;
  color: inherit;
}

.app-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: white;
  margin: 0;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.app-title:hover {
  opacity: 0.9;
}

.page-content {
  flex: 1;
  padding: 2rem 1.5rem;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

@media (min-width: 768px) {
  .page-content {
    padding: 2rem;
  }
}
</style>
