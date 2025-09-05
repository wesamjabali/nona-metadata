<template>
  <div class="layout">
    <!-- Global Header -->
    <header class="layout__header">
      <div class="layout__header-content">
        <NuxtLink to="/" class="layout__title-link">
          <h1 class="layout__title">nona-metadata</h1>
        </NuxtLink>
      </div>
    </header>

    <!-- Page Content -->
    <main class="layout__content">
      <slot />
    </main>
  </div>
</template>

<style lang="scss" scoped>
.layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;

  &__header {
    top: 0;
    z-index: 50;

    &-content {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0.75rem 1rem;

      @media (min-width: 768px) {
        padding: 1rem 1.5rem;
      }
    }
  }

  &__title {
    &-link {
      text-decoration: none;
      color: inherit;
    }

    font-size: 1.25rem;
    font-weight: 700;
    color: white;
    margin: 0;
    cursor: pointer;
    transition: opacity 0.2s ease;

    @media (min-width: 768px) {
      font-size: 1.5rem;
    }

    &:hover {
      opacity: 0.9;
    }
  }

  &__content {
    flex: 1;
    padding: 1rem;
    max-width: 1200px;
    margin: 0 auto;
    width: 100%;

    @media (min-width: 768px) {
      padding: 2rem 1.5rem;
    }

    @media (min-width: 1024px) {
      padding: 2rem;
    }
  }
}
</style>
