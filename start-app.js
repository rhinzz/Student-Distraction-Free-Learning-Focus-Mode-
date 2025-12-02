// start-app.js - Script start aplikasi
import Database from './database.js';

async function startApplication() {
  try {
    console.log('🚀 Starting FocusMode Application...');
    console.log('📍 Target: MySQL port 3307');
    
    // Test database connection first
    await Database.connect();
    
    console.log('✅ Database connected successfully!');
    console.log('📊 Starting API server...');
    
    // Import and start API server
    const { default: apiServer } = await import('./api-server.js');
    
  } catch (error) {
    console.error('❌ Failed to start application:', error.message);
    console.log('\n🔧 SOLUTIONS:');
    console.log('1. Buka XAMPP Control Panel');
    console.log('2. Start MySQL service');
    console.log('3. Pastikan port 3307 terbuka');
    console.log('4. Cek jika ada aplikasi lain yang menggunakan port 3307');
    
    process.exit(1);
  }
}

startApplication();