import { defineConfig } from '@apps-in-toss/web-framework/config';

// 앱 이름/아이콘/설명은 앱인토스 콘솔의 앱 정보에서 관리한다. 여기 appName은
// 콘솔에 등록된 값과 반드시 같아야 하고(intoss://yukjindae-map 딥링크 키), 한 번
// 등록하면 바꿀 수 없다.
export default defineConfig({
  appName: 'yukjindae-map',
  brand: {
    primaryColor: '#2D6CDF',
  },
  // 지도 화면의 "현재 위치" 버튼과 주변 탭이 위치 권한을 쓴다. 권한을 거부해도
  // 지역 선택으로 나머지 기능은 그대로 동작한다.
  permissions: [{ name: 'geolocation', access: 'access' }],
  webView: {
    // 지도를 두 손가락으로 확대/축소해야 해서 바운스와 당겨서 새로고침을 끈다.
    // 켜두면 지도 팬 제스처가 웹뷰 스크롤로 먹힌다.
    bounces: false,
    pullToRefreshEnabled: false,
  },
  webBundleDir: 'dist',
});
