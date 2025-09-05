<template>
  <Menubar :model="menuItems" class="header">
    <template #start>
      <NuxtLink to="/" class="header__brand">
        <span class="header__brand-text">nona-metadata</span>
      </NuxtLink>
    </template>
  </Menubar>
</template>

<script setup>
import Menubar from "primevue/menubar";

const menuItems = [
  {
    label: "Home",
    icon: "pi pi-home",
    to: "/",
  },
  {
    label: "Files",
    icon: "pi pi-folder",
    to: "/files",
  },
  {
    label: "Jobs",
    icon: "pi pi-cog",
    to: "/processing-jobs",
  },
  {
    label: "Cache",
    icon: "pi pi-database",
    to: "/cache",
  },
];
</script>

<style lang="scss" scoped>
.header {
  padding: 0.5rem 1rem;

  &__brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: bold;
    font-size: 1.25rem;
    text-decoration: none;

    &-text {
      margin-left: 0.5rem;
    }
  }
}

:deep(.p-menubar) {
  .p-menubar-start {
    margin-right: auto;
  }

  .p-menuitem-link {
    padding: 0.75rem 1rem;
    border-radius: 6px;
  }

  .p-menuitem-icon {
    margin-right: 0.5rem;
  }
}
</style>
