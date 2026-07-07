import re

with open('frontend/dashboard.html', 'r', encoding='utf-8') as f:
    content = f.read()

def replace_header(match):
    title = match.group(1).strip()
    icon_map = {
        'User Management': 'bi-people',
        'Academic Years': 'bi-calendar3',
        'Storage Settings': 'bi-hdd',
        'About': 'bi-info-circle',
        'Excel Import': 'bi-file-earmark-spreadsheet',
        'Student Search': 'bi-search',
        'Marks Entry': 'bi-pencil-square',
        'Previous Years\' Report Cards': 'bi-journal-bookmark'
    }
    subtitle_map = {
        'User Management': 'Manage system users and access roles',
        'Academic Years': 'Configure academic terms and active sessions',
        'Storage Settings': 'Configure where files are saved',
        'About': 'System information and credits',
        'Excel Import': 'Batch import student data from Excel',
        'Student Search': 'Find students and view report cards',
        'Marks Entry': 'Record student progress',
        'Previous Years\' Report Cards': 'Access archived reports'
    }
    
    icon = icon_map.get(title, 'bi-app-indicator')
    subtitle = subtitle_map.get(title, 'Manage ' + title)
    
    buttons = match.group(2).strip()
    
    new_header = f'''<div class="view-header d-flex justify-content-between align-items-center mb-4 pb-3 border-bottom">
                        <div>
                            <h1 class="h2 fw-bold text-dark mb-0"><i class="bi {icon} me-2 text-primary"></i> {title}</h1>
                            <p class="text-muted small mb-0 mt-1">{subtitle}</p>
                        </div>
                        <div class="view-actions">
                            {buttons}
                        </div>
                    </div>'''
    return new_header

# Find patterns like:
# <div class="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-3 border-bottom">
#     <h1 class="h2">User Management</h1>
#     <div>
#         ...buttons...
#     </div>
# </div>

pattern = re.compile(
    r'<div class="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-[34] border-bottom">\s*<h1 class="h2">(.*?)</h1>\s*<div[^>]*>(.*?)</div>\s*</div>', 
    re.DOTALL
)

new_content = pattern.sub(replace_header, content)

with open('frontend/dashboard.html', 'w', encoding='utf-8') as f:
    f.write(new_content)

print('Done replacing headers')
